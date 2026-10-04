/**
 * The only file that touches the ML libraries. Everything else uses the plain functions exported here
 * (or, better, the service in ./index). Models: SSD MobileNet v1 (detect), 68-point landmarks (align),
 * ResNet-34 descriptors (128 numbers). They ship inside the @vladmandic/face-api npm package, run on
 * the WASM backend (no native build), and load once, on first use.
 */
import path from 'path'
import { FACE } from './config'
import { FaceError, type DetectedFace } from './types'

let loading: Promise<any> | null = null
let chain: Promise<unknown> = Promise.resolve()
let waiting = 0

async function load() {
  await import('@tensorflow/tfjs')
  await import('@tensorflow/tfjs-backend-wasm')
  const mod: any = await import('@vladmandic/face-api/dist/face-api.node-wasm.js')
  const faceapi = mod.nets ? mod : mod.default
  await faceapi.tf.setBackend('wasm')
  await faceapi.tf.ready()
  const dir = FACE.modelDir || path.join(process.cwd(), 'node_modules', '@vladmandic', 'face-api', 'model')
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir)
  await faceapi.nets.faceLandmark68Net.loadFromDisk(dir)
  await faceapi.nets.faceRecognitionNet.loadFromDisk(dir)
  return faceapi
}

const getApi = () => (loading ??= load().catch((e) => { loading = null; throw e }))

/** Models are loaded lazily; call this at start-up if you want the first request to be fast. */
export const warmUp = async () => { await getApi() }
export const isLoaded = () => loading !== null

/** One image at a time (WASM is single-threaded); a short queue, then "busy". */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  if (waiting >= FACE.maxQueue) return Promise.reject(new FaceError('busy', 'Face check is busy. Try again.', 503))
  waiting++
  const run = chain.then(fn, fn)
  chain = run.catch(() => {}).finally(() => { waiting-- })
  return run
}

async function toTensor(faceapi: any, image: Buffer) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  let img: any
  try { img = await loadImage(image) } catch { throw new FaceError('bad_image', 'That file is not a readable image.', 422) }
  const scale = Math.min(1, FACE.maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2] }
  return { tensor: faceapi.tf.tensor3d(rgb, [h, w, 3], 'int32'), w, h }
}

/** Find every face in the image and return its 128-number descriptor. Largest face first. */
export function detectFaces(image: Buffer): Promise<DetectedFace[]> {
  return serial(async () => {
    const faceapi = await getApi()
    const { tensor, w, h } = await toTensor(faceapi, image)
    try {
      const found = await faceapi
        .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: FACE.minConfidence }))
        .withFaceLandmarks()
        .withFaceDescriptors()
      const faces: DetectedFace[] = found.map((f: any) => ({
        descriptor: Array.from(f.descriptor as Float32Array),
        score:      f.detection.score,
        box: { x: f.detection.box.x / w, y: f.detection.box.y / h, w: f.detection.box.width / w, h: f.detection.box.height / h },
      }))
      return faces.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    } finally {
      tensor.dispose()
    }
  })
}
