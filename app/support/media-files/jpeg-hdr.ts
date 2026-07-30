import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { exiftoolPath } from 'exiftool-vendored';

import { runImageMagick } from '../image-magick';
import { spawnAsync } from '../spawn-async';

type CreateJpegHdrPreviewOptions = {
  sourcePath: string;
  targetPath: string;
  width: number;
  height: number;
  quality?: number;
};

export type JpegHdrPreviewInfo = {
  numberOfImages?: number;
  mpImage2Length?: number;
  directoryItemLength?: number;
  gainMapImageLength?: number;
  iccProfileDescription?: string;
  validate?: string;
  warnings: string[];
};

const MPF_SEGMENT_LENGTH = 90;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_MARKER_PREFIX = 0xff;

/**
 * Creates a JPEG Ultra HDR preview from a JPEG source with an embedded gain map.
 *
 * Returns false when the source does not expose a JPEG gain map. Throws on
 * unexpected processing or validation failures.
 */
export async function createJpegHdrPreview({
  sourcePath,
  targetPath,
  width,
  height,
  quality = 90,
}: CreateJpegHdrPreviewOptions): Promise<boolean> {
  const workDir = await mkdtemp(join(dirname(targetPath), '.hdr-'));

  try {
    const gainMapPath = join(workDir, 'gain-map.jpg');
    const resizedGainMapPath = join(workDir, 'gain-map-resized.jpg');
    const iccPath = join(workDir, 'profile.icc');
    const basePath = join(workDir, 'base.jpg');

    const gainMap = await extractGainMap(sourcePath);

    if (!gainMap) {
      return false;
    }

    await writeFile(gainMapPath, gainMap);

    const sourceSize = await identifySize(sourcePath);
    const gainMapSize = await identifySize(gainMapPath);
    // The gain map must keep the same relative scale as in the original file.
    const gainMapTarget = scaledSize({ width, height }, sourceSize, gainMapSize);

    const hasIcc = await extractIccProfile(sourcePath, iccPath);

    await createCleanBaseJpeg(
      sourcePath,
      basePath,
      width,
      height,
      quality,
      hasIcc ? iccPath : null,
    );
    await resizeGainMap(gainMapPath, resizedGainMapPath, gainMapTarget.width, gainMapTarget.height);

    const resizedGainMapSize = await stat(resizedGainMapPath).then((s) => s.size);
    const baseWithXmpPath = join(workDir, 'base-with-xmp.jpg');
    await insertApp1Xmp(basePath, baseWithXmpPath, resizedGainMapSize);
    await assembleMpfJpeg(baseWithXmpPath, resizedGainMapPath, targetPath);

    // The generated file must be self-consistent before it enters previews storage.
    const info = await inspectJpegHdrPreview(targetPath);
    const { validate, numberOfImages, mpImage2Length, directoryItemLength, gainMapImageLength } =
      info;

    return (
      validate === 'OK' &&
      numberOfImages === 2 &&
      mpImage2Length === resizedGainMapSize &&
      directoryItemLength === resizedGainMapSize &&
      gainMapImageLength === resizedGainMapSize
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Reads the pieces that prove a generated JPEG is usable as an Ultra HDR preview.
 */
export async function inspectJpegHdrPreview(filePath: string): Promise<JpegHdrPreviewInfo> {
  const [tags, validation] = await Promise.all([
    exiftool([
      '-G1',
      '-a',
      '-s',
      '-MPF:all',
      '-MPImage2:all',
      '-XMP-GContainer:all',
      '-ICC_Profile:ProfileDescription',
      '-Google:GainMapImage',
      filePath,
    ]),
    exiftool(['-G1', '-a', '-s', '-warning', '-validate', filePath]),
  ]);

  return {
    numberOfImages: intTag(tags, 'NumberOfImages'),
    mpImage2Length: intTagInGroup(tags, 'MPImage2', 'MPImageLength'),
    directoryItemLength: intTag(tags, 'DirectoryItemLength') ?? intTag(tags, 'DirectoryLength'),
    gainMapImageLength: binaryLength(tags, 'GainMapImage') ?? binaryLength(tags, 'MPImage2'),
    iccProfileDescription: stringTag(tags, 'ProfileDescription'),
    validate: stringTag(validation, 'Validate'),
    warnings: tagValues(validation, 'Warning'),
  };
}

/**
 * Extracts the JPEG gain map payload from known ExifTool tag names.
 */
async function extractGainMap(sourcePath: string): Promise<Buffer | null> {
  const exe = await exiftoolPath();
  const gainMap = await extractGainMapTag(exe, sourcePath, 'GainMapImage');

  if (gainMap) {
    return gainMap;
  }

  return extractGainMapTag(exe, sourcePath, 'MPImage2');
}

/**
 * Extracts one binary ExifTool tag and accepts only JPEG payloads.
 */
async function extractGainMapTag(
  exe: string,
  sourcePath: string,
  tag: string,
): Promise<Buffer | null> {
  try {
    const { stdout } = await spawnAsync(exe, ['-b', `-${tag}`, sourcePath], { binary: true });
    return isJpeg(stdout) ? stdout : null;
  } catch {
    return null;
  }
}

/**
 * Checks for the JPEG start-of-image marker.
 */
function isJpeg(data: Buffer): boolean {
  return data.length >= JPEG_SOI.length && data.subarray(0, JPEG_SOI.length).equals(JPEG_SOI);
}

/**
 * Extracts the source ICC profile into a standalone profile file.
 */
async function extractIccProfile(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    await runImageMagick('convert', [sourcePath, targetPath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates the primary JPEG preview without EXIF/GPS/private metadata.
 */
async function createCleanBaseJpeg(
  sourcePath: string,
  targetPath: string,
  width: number,
  height: number,
  quality: number,
  iccPath: string | null,
): Promise<void> {
  await runImageMagick('convert', [
    sourcePath,
    '-auto-orient',
    ['-resize', `${width}!x${height}!`],
    // Drop all profiles first, then put back only the original ICC profile.
    '+profile',
    '*',
    ...(iccPath ? ['-profile', iccPath] : []),
    ['-quality', quality.toString()],
    targetPath,
  ]);
}

/**
 * Resizes the extracted gain map to match the primary preview scale.
 */
async function resizeGainMap(
  sourcePath: string,
  targetPath: string,
  width: number,
  height: number,
): Promise<void> {
  await runImageMagick('convert', [
    sourcePath,
    ['-resize', `${width}!x${height}!`],
    ['-quality', '90'],
    targetPath,
  ]);
}

/**
 * Returns ImageMagick-reported pixel dimensions.
 */
async function identifySize(filePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await runImageMagick('identify', ['-format', '%w %h', filePath]);
  const match = stdout.trim().match(/^(\d+)\s+(\d+)$/);

  if (!match) {
    throw new Error(`Cannot identify image size: ${filePath}`);
  }

  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid image size ${width}x${height}: ${filePath}`);
  }

  return { width, height };
}

/**
 * Scales a subject size by the same ratio as source -> target.
 */
function scaledSize(
  target: { width: number; height: number },
  source: { width: number; height: number },
  subject: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round((target.width * subject.width) / source.width)),
    height: Math.max(1, Math.round((target.height * subject.height) / source.height)),
  };
}

/**
 * Inserts APP1 XMP metadata into the primary JPEG.
 */
async function insertApp1Xmp(
  basePath: string,
  targetPath: string,
  gainMapLength: number,
): Promise<void> {
  const base = await readFile(basePath);
  const xmp = buildPrimaryXmp(gainMapLength);
  const insertOffset = findMetadataInsertOffset(base);
  await writeFile(
    targetPath,
    Buffer.concat([base.subarray(0, insertOffset), xmp, base.subarray(insertOffset)]),
  );
}

/**
 * Builds the final Ultra HDR JPEG: primary JPEG + MPF APP2 + appended gain map.
 */
async function assembleMpfJpeg(
  basePath: string,
  gainMapPath: string,
  targetPath: string,
): Promise<void> {
  const base = await readFile(basePath);
  const gainMap = await readFile(gainMapPath);
  const insertOffset = findMetadataInsertOffset(base);
  // MPF stores the final primary image size, including the MPF segment itself.
  const primaryLength = base.length + MPF_SEGMENT_LENGTH;
  const mpf = buildMpfSegment({
    mpfOffset: insertOffset,
    primaryLength,
    gainMapLength: gainMap.length,
  });

  await writeFile(
    targetPath,
    Buffer.concat([base.subarray(0, insertOffset), mpf, base.subarray(insertOffset), gainMap]),
  );
}

/**
 * Builds the APP1 XMP segment that describes the appended gain map.
 */
function buildPrimaryXmp(gainMapLength: number): Buffer {
  const xml =
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `<rdf:Description rdf:about="" xmlns:GContainer="http://ns.google.com/photos/1.0/container/" ` +
    `xmlns:GItem="http://ns.google.com/photos/1.0/container/item/">\n` +
    `<GContainer:Directory><rdf:Seq>` +
    `<rdf:li rdf:parseType="Resource"><GContainer:Item rdf:parseType="Resource">` +
    `<GItem:Mime>image/jpeg</GItem:Mime><GItem:Semantic>Primary</GItem:Semantic>` +
    `</GContainer:Item></rdf:li>` +
    `<rdf:li rdf:parseType="Resource"><GContainer:Item rdf:parseType="Resource">` +
    `<GItem:Length>${gainMapLength}</GItem:Length><GItem:Mime>image/jpeg</GItem:Mime>` +
    `<GItem:Semantic>GainMap</GItem:Semantic></GContainer:Item></rdf:li>` +
    `</rdf:Seq></GContainer:Directory>\n</rdf:Description>\n` +
    `<rdf:Description rdf:about="" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/">` +
    `<hdrgm:Version>1.0</hdrgm:Version>` +
    `</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;
  const payload = Buffer.concat([
    // Standard APP1 XMP namespace prefix.
    Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
    Buffer.from(xml, 'utf8'),
  ]);

  return jpegSegment(0xe1, payload);
}

/**
 * Builds the APP2 MPF segment with entries for primary image and gain map.
 */
function buildMpfSegment({
  mpfOffset,
  primaryLength,
  gainMapLength,
}: {
  mpfOffset: number;
  primaryLength: number;
  gainMapLength: number;
}): Buffer {
  const dataLength = 86;
  const data = Buffer.alloc(dataLength);
  data.write('MPF\0', 0, 'latin1');

  // MPF contains a TIFF-like little-endian directory after the "MPF\0" header.
  const tiff = 4;
  data.write('II', tiff, 'latin1');
  data.writeUInt16LE(42, tiff + 2);
  data.writeUInt32LE(8, tiff + 4);

  const ifd = tiff + 8;
  data.writeUInt16LE(3, ifd);
  let entry = ifd + 2;

  // MPFVersion, NumberOfImages, and MPEntry array.
  writeIfdEntry(data, entry, 0xb000, 7, 4, Buffer.from('0100', 'latin1'));
  entry += 12;
  writeIfdEntry(data, entry, 0xb001, 4, 1, 2);
  entry += 12;
  writeIfdEntry(data, entry, 0xb002, 7, 32, 50);
  entry += 12;
  data.writeUInt32LE(0, entry);

  // MP entries are stored at the offset advertised by the MPEntry IFD tag.
  const mpEntries = tiff + 50;
  writeMpEntry(data, mpEntries, {
    attributes: 0x00030000,
    size: primaryLength,
    offset: 0,
  });
  writeMpEntry(data, mpEntries + 16, {
    attributes: 0,
    size: gainMapLength,
    offset: mpImageOffset(primaryLength, mpfOffset),
  });

  return jpegSegment(0xe2, data);
}

/**
 * Returns the gain map MPF offset relative to the TIFF header start.
 */
function mpImageOffset(primaryLength: number, mpfOffset: number): number {
  const offset = primaryLength - (mpfOffset + 8);

  if (offset < 0) {
    throw new Error('Invalid MPF image offset');
  }

  return offset;
}

/**
 * Writes one 12-byte TIFF IFD entry into the MPF payload.
 */
function writeIfdEntry(
  data: Buffer,
  offset: number,
  tag: number,
  type: number,
  count: number,
  value: number | Buffer,
): void {
  data.writeUInt16LE(tag, offset);
  data.writeUInt16LE(type, offset + 2);
  data.writeUInt32LE(count, offset + 4);

  if (Buffer.isBuffer(value)) {
    value.copy(data, offset + 8);
  } else {
    data.writeUInt32LE(value, offset + 8);
  }
}

/**
 * Writes one 16-byte MP image entry.
 */
function writeMpEntry(
  data: Buffer,
  offset: number,
  {
    attributes,
    size,
    offset: imageOffset,
  }: {
    attributes: number;
    size: number;
    offset: number;
  },
): void {
  data.writeUInt32LE(attributes, offset);
  data.writeUInt32LE(size, offset + 4);
  data.writeUInt32LE(imageOffset, offset + 8);
  data.writeUInt16LE(0, offset + 12);
  data.writeUInt16LE(0, offset + 14);
}

/**
 * Wraps payload bytes into a JPEG APP segment.
 */
function jpegSegment(marker: number, payload: Buffer): Buffer {
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

/**
 * Finds the offset before JPEG image data/table segments where metadata belongs.
 */
function findMetadataInsertOffset(jpeg: Buffer): number {
  if (!isJpeg(jpeg)) {
    throw new Error('Not a JPEG file');
  }

  let offset = 2;

  while (offset < jpeg.length) {
    if (offset + 4 > jpeg.length) {
      throw new Error(`Truncated JPEG marker at offset ${offset}`);
    }

    if (jpeg[offset] !== JPEG_MARKER_PREFIX) {
      throw new Error(`Invalid JPEG marker at offset ${offset}`);
    }

    const marker = jpeg[offset + 1];

    // Stop before scan/image data or baseline/progressive/table segments.
    if (
      marker === 0xda ||
      marker === 0xdb ||
      marker === 0xc0 ||
      marker === 0xc2 ||
      marker === 0xc4 ||
      marker === 0xd9
    ) {
      return offset;
    }

    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }

  throw new Error('Cannot find JPEG metadata insert offset');
}

/**
 * Runs ExifTool and returns text output.
 */
async function exiftool(args: string[]): Promise<string> {
  const exe = await exiftoolPath();
  const { stdout } = await spawnAsync(exe, args);
  return stdout;
}

/**
 * Reads the first integer value from an ExifTool tag.
 */
function intTag(output: string, tag: string): number | undefined {
  const value = stringTag(output, tag);
  return value ? firstInteger(value) : undefined;
}

/**
 * Reads the first integer value from a tag in a specific ExifTool group.
 */
function intTagInGroup(output: string, group: string, tag: string): number | undefined {
  const value = stringTagInGroup(output, group, tag);
  return value ? firstInteger(value) : undefined;
}

/**
 * Reads the byte length from ExifTool binary tag output.
 */
function binaryLength(output: string, tag: string): number | undefined {
  const value = stringTag(output, tag);
  return value ? firstInteger(value) : undefined;
}

/**
 * Extracts the first decimal integer from a string.
 */
function firstInteger(value: string): number | undefined {
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : undefined;
}

/**
 * Reads the first ExifTool tag value regardless of group.
 */
function stringTag(output: string, tag: string): string | undefined {
  return tagValues(output, tag)[0];
}

/**
 * Reads the first ExifTool tag value from the given group.
 */
function stringTagInGroup(output: string, group: string, tag: string): string | undefined {
  const re = new RegExp(`^\\[${group}\\]\\s+${tag}\\s+:\\s+(.+)$`, 'gm');
  return [...output.matchAll(re)].map((m) => m[1])[0];
}

/**
 * Reads all ExifTool tag values with the given tag name.
 */
function tagValues(output: string, tag: string): string[] {
  const re = new RegExp(`^\\[[^\\]]+\\]\\s+${tag}\\s+:\\s+(.+)$`, 'gm');
  return [...output.matchAll(re)].map((m) => m[1]);
}
