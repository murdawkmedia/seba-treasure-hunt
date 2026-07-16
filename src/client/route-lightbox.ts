export function cyclePhotoIndex(current: number, delta: -1 | 1, length: number): number {
  if (!Number.isInteger(current) || !Number.isInteger(length) || length <= 1) return 0;
  return (current + delta + length) % length;
}

export function swipePhotoDelta(startX: number | null, endX: number, threshold = 48): -1 | 0 | 1 {
  if (startX === null || !Number.isFinite(endX)) return 0;
  const distance = endX - startX;
  if (Math.abs(distance) < threshold) return 0;
  return distance < 0 ? 1 : -1;
}
