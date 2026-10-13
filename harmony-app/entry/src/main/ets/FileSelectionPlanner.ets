/**
 * Decides which HarmonyOS system picker answers a web page's file-upload
 * request, and with which options.
 *
 * ArkWeb reports the page's `accept` filter twice: as MIME tokens
 * (`getMimeTypes`) and as file extensions (`getAcceptType`). A request that
 * accepts nothing but images and/or videos is served by the media library
 * picker, the only picker that can see the gallery. Every other request is
 * served by the document picker, filtered by the page's suffixes.
 */

export enum MediaKind {
  None = 0,
  Image = 1,
  Video = 2,
  ImageAndVideo = 3,
}

export interface FileSelectionPlan {
  /** True when the request accepts only images and/or videos. */
  useMediaPicker: boolean;
  mediaKind: MediaKind;
  /** Suffix filters for the document picker; empty means "no filter". */
  fileSuffixFilters: Array<string>;
  /** 1 for a single-file request; 0 leaves the picker's multi-select default. */
  maxSelectNumber: number;
}

// ArkWeb's image/video extension tables. An `accept` written with extensions
// has to classify the same way as one written with MIME types.
const IMAGE_EXTENSIONS: Array<string> = [
  'tif', 'xbm', 'tiff', 'pjp', 'jfif', 'bmp', 'avif', 'apng',
  'ico', 'webp', 'svg', 'gif', 'svgz', 'jpg', 'jpeg', 'png', 'pjpeg',
];
const VIDEO_EXTENSIONS: Array<string> = [
  'mp4', 'mpg', 'mpeg', 'm4v', 'ogm', 'ogv', 'webm',
];

/** Flattens the accept lists; ArkWeb may pack several entries into one string. */
function splitTokens(values: Array<string>): Array<string> {
  const tokens: Array<string> = [];
  for (let i = 0; i < values.length; i++) {
    const parts: Array<string> = values[i].split(',');
    for (let j = 0; j < parts.length; j++) {
      const token: string = parts[j].trim();
      if (token.length > 0) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function mediaKindOfToken(token: string): MediaKind {
  const value: string = token.toLowerCase();
  if (value.startsWith('image/')) {
    return MediaKind.Image;
  }
  if (value.startsWith('video/')) {
    return MediaKind.Video;
  }
  const dot: number = value.lastIndexOf('.');
  if (dot < 0 || dot === value.length - 1) {
    return MediaKind.None;
  }
  const extension: string = value.substring(dot + 1);
  if (IMAGE_EXTENSIONS.includes(extension)) {
    return MediaKind.Image;
  }
  if (VIDEO_EXTENSIONS.includes(extension)) {
    return MediaKind.Video;
  }
  return MediaKind.None;
}

/** Builds the document picker's suffix filter out of the accept extensions. */
function suffixFilterOf(acceptTypes: Array<string>): Array<string> {
  const extensions: Array<string> = [];
  const tokens: Array<string> = splitTokens(acceptTypes);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith('.')) {
      extensions.push(tokens[i]);
    }
  }
  return extensions.length > 0 ? [extensions.join(',')] : [];
}

export function planFileSelection(
  acceptTypes: Array<string>,
  mimeTypes: Array<string>,
  multiple: boolean,
): FileSelectionPlan {
  const tokens: Array<string> = splitTokens(acceptTypes.concat(mimeTypes));
  let hasImage: boolean = false;
  let hasVideo: boolean = false;
  let hasOther: boolean = false;
  for (let i = 0; i < tokens.length; i++) {
    const kind: MediaKind = mediaKindOfToken(tokens[i]);
    if (kind === MediaKind.Image) {
      hasImage = true;
    } else if (kind === MediaKind.Video) {
      hasVideo = true;
    } else {
      hasOther = true;
    }
  }

  const mediaOnly: boolean = (hasImage || hasVideo) && !hasOther;
  let mediaKind: MediaKind = MediaKind.None;
  if (mediaOnly) {
    if (hasImage && hasVideo) {
      mediaKind = MediaKind.ImageAndVideo;
    } else {
      mediaKind = hasVideo ? MediaKind.Video : MediaKind.Image;
    }
  }

  return {
    useMediaPicker: mediaOnly,
    mediaKind: mediaKind,
    fileSuffixFilters: mediaOnly ? [] : suffixFilterOf(acceptTypes),
    maxSelectNumber: multiple ? 0 : 1,
  };
}
