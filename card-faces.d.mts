export type DisplayFace = {
  name: string;
  image_url: string;
  large_image_url?: string;
  role: 'front' | 'back' | 'meld_result';
  partner_name?: string;
};
export type FaceCard = {name?: string; image_url?: string | null; display_faces?: DisplayFace[]};
export function normalizedDisplayFaces(value: unknown): DisplayFace[];
export function cardDisplayFaces(card?: FaceCard | null): DisplayFace[];
export function cardFaceIndicator(card?: FaceCard | null): string;
export function faceLabel(face: DisplayFace): string;
