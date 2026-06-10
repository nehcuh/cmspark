declare module "canvas" {
  export function createCanvas(width: number, height: number): HTMLCanvasElement & {
    toBuffer(mime: string): Buffer
  }
}
