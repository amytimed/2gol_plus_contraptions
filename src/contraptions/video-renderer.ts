import { spawn } from 'child_process';
import path from 'path';

const FRAME_RATE = 60;
const MAX_VIDEO_SECONDS = 30; // Keep final video under 1 minute

export function createVideo(
    frameDir: string,
    totalDurationSec: number,
    outputFile: string,
    audioPath?: string // Optional path to the audio file
): Promise<void> {
    return new Promise((resolve, reject) => {
        let ffmpegArgs: string[];

        // Base arguments for video input
        const baseInputArgs = [
            '-y', // Overwrite output file if it exists
            '-framerate', FRAME_RATE.toString(),
            '-i', path.join(frameDir, 'frame_%d.png'), // Video input stream 0
        ];

        // Add audio input if provided
        if (audioPath) {
            baseInputArgs.push('-i', audioPath); // Audio input stream 1
        }

        // Common output arguments for video
        const videoOutputArgs = [
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
        ];

        // Common output arguments for audio (if it exists)
        const audioOutputArgs = audioPath ? [
            '-c:a', 'aac',    // Use the AAC audio codec
            '-b:a', '192k',   // Set a good audio bitrate
            '-shortest',      // Finish encoding when the shortest input stream (the video) ends
        ] : [];


        // Time-warping logic for videos longer than 20 seconds
        if (totalDurationSec > 20) {
            const startNormalSec = totalDurationSec * 0.2;
            const endNormalSec = totalDurationSec * 0.8;
            const middleDurationSec = endNormalSec - startNormalSec;

            // Calculate how much to speed up the middle to fit within the max video length
            const targetMiddleDuration = MAX_VIDEO_SECONDS - (2 * startNormalSec);
            const speedupFactor = middleDurationSec / targetMiddleDuration;

            // This filter only operates on the first input [0:v] (the frames)
            const filter = `[0:v]trim=0:${startNormalSec},setpts=PTS-STARTPTS[v1];` +
                `[0:v]trim=${startNormalSec}:${endNormalSec},setpts=${1 / speedupFactor}*(PTS-STARTPTS)[v2];` +
                `[0:v]trim=${endNormalSec},setpts=PTS-STARTPTS[v3];` +
                `[v1][v2][v3]concat=n=3:v=1[outv]`;

            // Define stream mapping. We take the filtered video [outv] and the original audio [1:a]
            const mappingArgs = audioPath ? [
                '-map', '[outv]', // Map the processed video
                '-map', '1:a',    // Map the audio from the second input (stream 1)
            ] : [
                '-map', '[outv]', // Map only the processed video
            ];

            ffmpegArgs = [
                ...baseInputArgs,
                '-filter_complex', filter,
                ...mappingArgs,
                ...videoOutputArgs,
                ...audioOutputArgs,
                outputFile
            ];
        } else {
            // Standard rendering for shorter videos
            // We still need to map the streams to be explicit
            const mappingArgs = audioPath ? [
                '-map', '0:v',    // Map video from the first input (stream 0)
                '-map', '1:a',    // Map audio from the second input (stream 1)
            ] : [];

            ffmpegArgs = [
                ...baseInputArgs,
                ...mappingArgs,
                ...videoOutputArgs,
                ...audioOutputArgs,
                outputFile
            ];
        }

        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        ffmpeg.stderr.on('data', (data) => {
            // console.log(`ffmpeg stderr: ${data}`); // Uncomment for verbose debugging
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                console.error('ffmpeg command:', 'ffmpeg', ffmpegArgs.join(' ')); // Log the command on error
                reject(new Error(`ffmpeg process exited with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`Failed to start ffmpeg process: ${err.message}. Is ffmpeg installed and in your PATH?`));
        });
    });
}