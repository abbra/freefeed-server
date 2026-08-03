import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { exiftoolPath } from 'exiftool-vendored';

import { runImageMagick } from '../image-magick';
import { spawnAsync } from '../spawn-async';

import {
  assembleMpfJpeg,
  createCleanBaseJpeg,
  extractIccProfile,
  findJpegSegment,
  findMetadataInsertOffset,
  identifySize,
  isJpeg,
  scaledSize,
  type ImageSize,
  type JpegSegment,
} from './jpeg-hdr-utils';

type CreateAppleJpegHdrPreviewOptions = {
  sourcePath: string;
  targetPath: string;
  width: number;
  height: number;
  quality: number;
};

const APP2 = 0xe2;
const APP10 = 0xea;
const ICC_PROFILE_PREFIX = Buffer.from('ICC_PROFILE', 'latin1');
const ISO_GAIN_MAP_PREFIX = Buffer.from('urn:iso:std:iso:ts:21496:-1', 'latin1');
const AROT_PREFIX = Buffer.from('AROT', 'latin1');
const APPLE_GAIN_MAP_VERSION = Buffer.from('HDRGainMapVersion', 'latin1');

/**
 * Creates an Apple Adaptive HDR preview and returns null for non-Apple JPEGs.
 */
export async function createAppleJpegHdrPreview({
  sourcePath,
  targetPath,
  width,
  height,
  quality,
}: CreateAppleJpegHdrPreviewOptions): Promise<boolean | null> {
  const source = await readFile(sourcePath);
  const primaryArot = findJpegSegment(source, APP10, AROT_PREFIX);

  if (!primaryArot) {
    return null;
  }

  const gainMap = await extractGainMap(sourcePath);
  const gainMapArot = gainMap && findJpegSegment(gainMap, APP10, AROT_PREFIX);

  if (!gainMap || !gainMapArot || !gainMap.includes(APPLE_GAIN_MAP_VERSION)) {
    return null;
  }

  const primaryIso = findJpegSegment(source, APP2, ISO_GAIN_MAP_PREFIX);
  const gainMapIso = findJpegSegment(gainMap, APP2, ISO_GAIN_MAP_PREFIX);
  const workDir = await mkdtemp(join(dirname(targetPath), '.apple-hdr-'));

  try {
    const gainMapPath = join(workDir, 'gain-map.jpg');
    const resizedGainMapPath = join(workDir, 'gain-map-resized.jpg');
    const restoredGainMapPath = join(workDir, 'gain-map-restored.jpg');
    const iccPath = join(workDir, 'profile.icc');
    const basePath = join(workDir, 'base.jpg');
    const restoredBasePath = join(workDir, 'base-restored.jpg');

    await writeFile(gainMapPath, gainMap);

    const [sourceSize, gainMapSize, orientation, hasIcc] = await Promise.all([
      identifySize(sourcePath),
      identifySize(gainMapPath),
      readOrientation(sourcePath),
      extractIccProfile(sourcePath, iccPath),
    ]);
    const orientedSourceSize = orientSize(sourceSize, orientation);
    const orientedGainMapSize = orientSize(gainMapSize, orientation);
    const gainMapTarget = scaledSize({ width, height }, orientedSourceSize, orientedGainMapSize);

    await createCleanBaseJpeg(
      sourcePath,
      basePath,
      width,
      height,
      quality,
      hasIcc ? iccPath : null,
    );
    await resizeGainMap(gainMapPath, resizedGainMapPath, gainMapTarget, orientation);

    const [base, resizedGainMap] = await Promise.all([
      readFile(basePath),
      readFile(resizedGainMapPath),
    ]);
    const restoredBase = restoreHdrSegments(base, primaryIso, primaryArot);
    const restoredGainMap = restoreHdrSegments(resizedGainMap, gainMapIso, gainMapArot);

    await Promise.all([
      writeFile(restoredBasePath, restoredBase),
      writeFile(restoredGainMapPath, restoredGainMap),
    ]);
    await assembleMpfJpeg(restoredBasePath, restoredGainMapPath, targetPath);

    return validateApplePreview(targetPath, restoredGainMap.length);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Extracts the MPF secondary JPEG used as the Apple gain map.
 */
async function extractGainMap(sourcePath: string): Promise<Buffer | null> {
  try {
    const exe = await exiftoolPath();
    const { stdout } = await spawnAsync(exe, ['-b', '-MPImage2', sourcePath], { binary: true });
    return isJpeg(stdout) ? stdout : null;
  } catch {
    return null;
  }
}

/**
 * Reads the numeric EXIF orientation, defaulting to the normal orientation.
 */
async function readOrientation(sourcePath: string): Promise<number> {
  const exe = await exiftoolPath();
  const { stdout } = await spawnAsync(exe, ['-n', '-s3', '-Orientation', sourcePath]);
  const orientation = parseInt(stdout.trim(), 10);
  return orientation >= 1 && orientation <= 8 ? orientation : 1;
}

/**
 * Applies the source orientation before resizing the Apple gain map.
 */
async function resizeGainMap(
  sourcePath: string,
  targetPath: string,
  targetSize: ImageSize,
  orientation: number,
): Promise<void> {
  await runImageMagick('convert', [
    sourcePath,
    ...orientationArgs(orientation),
    ['-resize', `${targetSize.width}!x${targetSize.height}!`],
    ['-quality', '90'],
    targetPath,
  ]);
}

/**
 * Returns ImageMagick operations equivalent to an EXIF orientation.
 */
function orientationArgs(orientation: number): string[] {
  switch (orientation) {
    case 2:
      return ['-flop'];
    case 3:
      return ['-rotate', '180'];
    case 4:
      return ['-flip'];
    case 5:
      return ['-transpose'];
    case 6:
      return ['-rotate', '90'];
    case 7:
      return ['-transverse'];
    case 8:
      return ['-rotate', '270'];
    default:
      return [];
  }
}

/**
 * Swaps dimensions for orientations that rotate the image by 90 degrees.
 */
function orientSize(size: ImageSize, orientation: number): ImageSize {
  return orientation >= 5 ? { width: size.height, height: size.width } : size;
}

/**
 * Restores ISO 21496-1 and AROT segments stripped by ImageMagick.
 */
function restoreHdrSegments(
  jpeg: Buffer,
  isoSegment: JpegSegment | null,
  arotSegment: JpegSegment,
): Buffer {
  const iso = isoSegment?.data ?? Buffer.alloc(0);
  const icc = findJpegSegment(jpeg, APP2, ICC_PROFILE_PREFIX);

  if (!icc) {
    const insertOffset = findMetadataInsertOffset(jpeg);
    return Buffer.concat([
      jpeg.subarray(0, insertOffset),
      iso,
      arotSegment.data,
      jpeg.subarray(insertOffset),
    ]);
  }

  return Buffer.concat([
    jpeg.subarray(0, icc.offset),
    iso,
    icc.data,
    arotSegment.data,
    jpeg.subarray(icc.offset + icc.data.length),
  ]);
}

/**
 * Verifies the MPF index, both AROT curves, and ExifTool validation result.
 */
async function validateApplePreview(filePath: string, gainMapLength: number): Promise<boolean> {
  const exe = await exiftoolPath();
  const [{ stdout: tags }, { stdout: validation }] = await Promise.all([
    spawnAsync(exe, [
      '-G3:1',
      '-a',
      '-s',
      '-ee3',
      '-MPF:all',
      '-HDRGainCurveSize',
      '-XMP-hdrgm:all',
      '-XMP-GContainer:all',
      filePath,
    ]),
    spawnAsync(exe, ['-G1', '-a', '-s', '-warning', '-validate', filePath]),
  ]);
  const curveSizes = tagValues(tags, 'HDRGainCurveSize');

  return (
    tagValue(tags, 'NumberOfImages') === '2' &&
    parseInt(tagValueInGroup(tags, 'MPImage2', 'MPImageLength') ?? '', 10) === gainMapLength &&
    curveSizes.length === 2 &&
    !tags.includes('[XMP-hdrgm]') &&
    !tags.includes('[XMP-GContainer]') &&
    tagValue(validation, 'Validate') === 'OK' &&
    tagValues(validation, 'Warning').length === 0
  );
}

/**
 * Reads the first ExifTool value from a specific group.
 */
function tagValueInGroup(output: string, group: string, tag: string): string | undefined {
  const re = new RegExp(`^\\[${group}\\]\\s+${tag}\\s+:\\s+(.+)$`, 'gm');
  return [...output.matchAll(re)].map((match) => match[1])[0];
}

/**
 * Reads the first ExifTool value with the given tag name.
 */
function tagValue(output: string, tag: string): string | undefined {
  return tagValues(output, tag)[0];
}

/**
 * Reads all ExifTool values with the given tag name.
 */
function tagValues(output: string, tag: string): string[] {
  const re = new RegExp(`^\\[[^\\]]+\\]\\s+${tag}\\s+:\\s+(.+)$`, 'gm');
  return [...output.matchAll(re)].map((match) => match[1]);
}
