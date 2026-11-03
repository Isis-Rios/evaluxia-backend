import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { imageSize } from 'image-size';
import { AppError } from '@/shared/errors/AppError';

/**
 * PrototypeImageUploadService (P1) — Upload seguro de la imagen de un
 * prototipo. Nunca confía en `mimetype`/nombre de archivo declarados por el
 * cliente: el FORMATO REAL se determina exclusivamente por los primeros
 * bytes del archivo (firma binaria), y el nombre físico es siempre
 * generado por el servidor (UUID), nunca derivado del nombre original
 * (sección 20 del prompt de implementación — elimina path traversal por
 * construcción).
 */

export type AllowedImageFormat = 'png' | 'jpeg' | 'webp';

/**
 * 10MB — LÍMITE PROPIO DE PRODUCTO para el MVP de EvalUXIA (decisión P6.1),
 * NO una afirmación sobre el límite real de Gemini Vision (nunca verificado
 * contra la API real en este repo, y no se afirma que coincidan). Revisado
 * técnicamente (P6.1): ni `express.json()`/`urlencoded()` (que no procesan
 * multipart/form-data, fuera de su alcance) ni el gate de presupuesto J2
 * (`AiService.evaluatePayloadBudget`, que mide ÚNICAMENTE el prompt de
 * texto -- nunca el payload base64 de la imagen, ver
 * `generateMultimodalStructuredWithUsage`) colisionan con este límite; el
 * flujo multimodal implementado (mock) funciona correctamente hasta este
 * tamaño. Si en el futuro se confirma un límite real de Gemini Vision
 * distinto, este valor se ajusta independientemente -- son dos decisiones
 * separadas por diseño.
 */
export const PROTOTYPE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const MIN_DIMENSION_PX = 50;
const MAX_DIMENSION_PX = 8000;

export interface StoredPrototypeImage {
  url: string;
  absolutePath: string;
  format: AllowedImageFormat;
  width: number;
  height: number;
  byteSize: number;
}

/**
 * Detección de formato por firma binaria (magic bytes) — SVG y GIF quedan
 * excluidos por diseño (nunca reconocidos por esta función, sección 20):
 * SVG es XML ejecutable (riesgo de XSS/script embebido), GIF se excluye por
 * simplicidad de MVP (sin justificación de uso real para un prototipo
 * estático). Un archivo renombrado (ej. ".svg" renombrado a ".png") es
 * rechazado porque su firma real nunca coincide con ninguna de las tres
 * reconocidas aquí.
 */
export function detectImageFormat(buffer: Buffer): AllowedImageFormat | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

const FORMAT_TO_EXTENSION: Record<AllowedImageFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

const FORMAT_TO_MIME: Record<AllowedImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function mimeTypeForFormat(format: AllowedImageFormat): string {
  return FORMAT_TO_MIME[format];
}

export class PrototypeImageUploadService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'prototypes');

  /**
   * Valida y persiste el buffer de una imagen subida. Nunca escribe a disco
   * antes de que TODAS las validaciones (tamaño, firma binaria, dimensiones)
   * hayan pasado.
   */
  public store(file: { buffer: Buffer; size: number; originalname?: string }): StoredPrototypeImage {
    if (!file.buffer || file.buffer.length === 0) {
      throw new AppError('El archivo de imagen está vacío.', 400);
    }

    if (file.size > PROTOTYPE_IMAGE_MAX_BYTES) {
      throw new AppError(
        `La imagen excede el tamaño máximo permitido (${PROTOTYPE_IMAGE_MAX_BYTES} bytes).`,
        400,
      );
    }

    const format = detectImageFormat(file.buffer);
    if (!format) {
      throw new AppError(
        'Formato de imagen no soportado o no reconocible por su firma binaria real. Formatos permitidos: PNG, JPEG, WEBP.',
        400,
      );
    }

    let dimensions: { width?: number; height?: number };
    try {
      dimensions = imageSize(file.buffer);
    } catch {
      throw new AppError('No fue posible leer las dimensiones de la imagen -- el archivo puede estar corrupto.', 400);
    }

    const width = dimensions.width ?? 0;
    const height = dimensions.height ?? 0;
    if (width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) {
      throw new AppError(`La imagen es demasiado pequeña (mínimo ${MIN_DIMENSION_PX}x${MIN_DIMENSION_PX}px).`, 400);
    }
    if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
      throw new AppError(`La imagen excede las dimensiones máximas permitidas (${MAX_DIMENSION_PX}x${MAX_DIMENSION_PX}px).`, 400);
    }

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

    // Nombre físico SIEMPRE generado por el servidor -- `file.originalname`
    // nunca se usa para construir la ruta (elimina path traversal por
    // construcción). La extensión proviene de la firma binaria VALIDADA,
    // nunca del nombre declarado por el cliente.
    const filename = `prototype_${crypto.randomUUID()}.${FORMAT_TO_EXTENSION[format]}`;
    const absolutePath = path.join(this.uploadDir, filename);
    fs.writeFileSync(absolutePath, file.buffer);

    return {
      url: `/uploads/prototypes/${filename}`,
      absolutePath,
      format,
      width,
      height,
      byteSize: file.size,
    };
  }
}

export const prototypeImageUploadService = new PrototypeImageUploadService();
