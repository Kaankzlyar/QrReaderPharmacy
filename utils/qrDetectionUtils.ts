/**
 * QR Code Detection Utilities
 * 
 * This file contains algorithms for QR code detection, tracking, and validation
 * separated from the react-native-vision-camera library logic.
 */

export interface QRFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewfinderRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DetectionTrack {
  code: string;
  frame: QRFrame;
  hitCount: number;
  lastSeen: number;
}

export interface BarcodeBox {
  id: string;
  data: string;
  color: string;
  frame: QRFrame;
  timestamp: number;
  regionIndex?: number;
  indexInRegion?: number;
}

export interface DetectionConfig {
  confirmationThreshold: number;
  iouThreshold: number;
  minBoxAreaRatio: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  trackTimeout: number;
}

/**
 * Calculate Intersection over Union (IoU) between two rectangles
 * Used to determine if two detected QR codes are the same across frames
 */
export const calculateIoU = (rect1: QRFrame, rect2: QRFrame): number => {
  const x1 = Math.max(rect1.x, rect2.x);
  const y1 = Math.max(rect1.y, rect2.y);
  const x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
  const y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);

  if (x2 < x1 || y2 < y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = rect1.width * rect1.height;
  const area2 = rect2.width * rect2.height;
  const union = area1 + area2 - intersection;

  return intersection / union;
};

/**
 * Check if a point is within a rectangle
 */
export const pointInRect = (
  x: number,
  y: number,
  rect: ViewfinderRect
): boolean => {
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
};

/**
 * Validate QR code detection based on position, size, and aspect ratio
 */
export const isValidQRDetection = (
  frame: QRFrame,
  viewfinder: ViewfinderRect,
  screenWidth: number,
  screenHeight: number,
  config: DetectionConfig
): boolean => {
  // Check if center point is in viewfinder
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  const inViewfinder = pointInRect(centerX, centerY, viewfinder);

  if (!inViewfinder) return false;

  // Check minimum box area
  const screenArea = screenWidth * screenHeight;
  const boxArea = frame.width * frame.height;
  if (boxArea / screenArea < config.minBoxAreaRatio) return false;

  // Check aspect ratio
  const aspectRatio = frame.width / frame.height;
  if (aspectRatio < config.minAspectRatio || aspectRatio > config.maxAspectRatio) {
    return false;
  }

  return true;
};

/**
 * Find matching track for a detected QR code
 */
export const findMatchingTrack = (
  code: string,
  frame: QRFrame,
  tracks: DetectionTrack[],
  iouThreshold: number
): { track: DetectionTrack; index: number } | null => {
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (track.code === code) {
      const iou = calculateIoU(track.frame, frame);
      if (iou >= iouThreshold) {
        return { track, index: i };
      }
    }
  }
  return null;
};

/**
 * Update detection track with new frame data
 */
export const updateTrack = (
  track: DetectionTrack,
  frame: QRFrame,
  timestamp: number
): DetectionTrack => {
  return {
    ...track,
    hitCount: track.hitCount + 1,
    frame: { ...frame },
    lastSeen: timestamp,
  };
};

/**
 * Create a new detection track
 */
export const createTrack = (
  code: string,
  frame: QRFrame,
  timestamp: number
): DetectionTrack => {
  return {
    code,
    frame: { ...frame },
    hitCount: 1,
    lastSeen: timestamp,
  };
};

/**
 * Remove expired tracks based on timeout
 */
export const cleanupExpiredTracks = (
  tracks: DetectionTrack[],
  currentTime: number,
  timeout: number
): DetectionTrack[] => {
  return tracks.filter((track) => currentTime - track.lastSeen < timeout);
};

/**
 * Assign regions to QR codes based on their spatial position
 * Groups QR codes into regions of 4 (top-to-bottom, left-to-right)
 */
export const assignRegionsToBoxes = (boxes: BarcodeBox[]): BarcodeBox[] => {
  const sorted = [...boxes].sort((a, b) => {
    const aCenterY = a.frame.y + a.frame.height / 2;
    const bCenterY = b.frame.y + b.frame.height / 2;

    // Sort by Y first (top to bottom)
    if (Math.abs(aCenterY - bCenterY) > 5) {
      return aCenterY - bCenterY;
    }

    // Then by X (left to right) if on same row
    const aCenterX = a.frame.x + a.frame.width / 2;
    const bCenterX = b.frame.x + b.frame.width / 2;
    return aCenterX - bCenterX;
  });

  return sorted.map((box, idx) => ({
    ...box,
    regionIndex: Math.floor(idx / 4), // Each 4 QR codes = 1 region
    indexInRegion: idx % 4,
  }));
};

/**
 * Check if QR code has been confirmed based on hit count
 */
export const isQRConfirmed = (
  track: DetectionTrack,
  threshold: number
): boolean => {
  return track.hitCount >= threshold;
};
