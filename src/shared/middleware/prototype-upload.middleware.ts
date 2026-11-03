import multer from 'multer';
import { PROTOTYPE_IMAGE_MAX_BYTES } from '@/modules/evaluations/services/prototype-image-upload.service';

/**
 * Multer config for the prototype image upload endpoint (P1). Memory
 * storage only -- the buffer is inspected (magic bytes, dimensions) by
 * `prototypeImageUploadService.store` BEFORE anything is ever written to
 * disk, and the physical filename is always server-generated there (never
 * `file.originalname`). `fileSize` here is a fast, request-level rejection
 * before even buffering the whole body; `prototypeImageUploadService` still
 * re-checks size as defense in depth.
 */
export const prototypeImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROTOTYPE_IMAGE_MAX_BYTES, files: 1 },
}).single('image');
