/**
 * Timeline visibility levels
 *
 * These constants define the visibility levels for user timelines, controlling
 * what content is accessible to different viewers:
 *
 * - NONE: Timeline is completely hidden and inaccessible
 * - PINNED_ONLY: Only pinned posts are visible to viewers
 * - FULL: All timeline content (including metadata like subscribers,
 *   subscriptions and admins) is fully visible and accessible
 *
 * @see Timeline.getVisibilityLevel
 */
export const TIMELINE_VISIBILITY_NONE = 'none';
export const TIMELINE_VISIBILITY_PINNED_ONLY = 'pinned_only';
export const TIMELINE_VISIBILITY_FULL = 'full';
