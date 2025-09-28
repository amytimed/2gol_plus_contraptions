import GIFEncoder from 'gif-encoder-2';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export async function createGif(frames: Buffer[], width: number, height: number): Promise<Buffer> {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(width, height, 'neuquant', true);
    encoder.start();
    encoder.setRepeat(-1); // 0 for non-looping
    encoder.setDelay(1000 / 30); // 30 FPS
    encoder.setQuality(10); // Lower is higher quality

    for (const frameBuffer of frames) {
        const image = await loadImage(frameBuffer);
        ctx.drawImage(image, 0, 0);
        encoder.addFrame(ctx as any); // The types are slightly mismatched but it works
    }

    encoder.finish();
    return encoder.out.getData();
}