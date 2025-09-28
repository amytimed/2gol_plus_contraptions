import Matter, { Vector } from 'matter-js';
import { createCanvas, loadImage, Image, GlobalFonts } from '@napi-rs/canvas';
import type { Build } from './build';
import { PartType, Rotation } from './types';
import path from 'path';
import fs from 'fs/promises';

const { Engine, Composite, Bodies, Constraint, Events } = Matter;

// --- Simulation Constants ---
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const PART_SIZE = 64;
const PLAYER_WIDTH = PART_SIZE * 0.5;
const PLAYER_HEIGHT = PART_SIZE;
export const SIMULATION_DURATION_MS = 90000; // Longer duration
const FRAME_RATE = 30;
const WHEEL_RADIUS = PART_SIZE * 0.4;
const WHEEL_SPIN_SPEED = 0.4 / 5; // Torque value
const SPRING_STIFFNESS = 0.05;
const WELD_BREAK_FORCE = 7;

// --- Debris Scaling ---
const DEBRIS_SPAWN_INTERVAL_MS = 2000;
const DEBRIS_MASS_START = 5;
const DEBRIS_MASS_END = 100;
const DEBRIS_VELOCITY_START = 5;
const DEBRIS_VELOCITY_END = 25;

try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', '..', 'assets', 'contraptions', 'font', 'outfit.ttf'), 'Outfit');
} catch (e) { console.error("Could not load font.", e); }

const collisionCategories = {
    default: 0x0001,
    ground: 0x0002,
    player: 0x0004,
    debris: 0x0008,
};

// New type for the live update callback
export type FrameCallback = (frameBuffer: Buffer, progress: number) => Promise<void>;

export async function runSimulation(greenBuild: Build, purpleBuild: Build, onFrame: FrameCallback, frameDir: string): Promise<void> {
    const engine = Engine.create();
    engine.world.gravity.y = 1;

    const assets = {
        [PartType.Box]: await loadImage(path.join(__dirname, '..', '..', 'assets', 'contraptions', 'box.png')),
        [PartType.Wheel]: await loadImage(path.join(__dirname, '..', '..', 'assets', 'contraptions', 'wheel.png')),
        [PartType.Spring]: await loadImage(path.join(__dirname, '..', '..', 'assets', 'contraptions', 'spring.png')),
        greenPlayer: await loadImage(path.join(__dirname, '..', '..', 'assets', 'contraptions', 'green.png')),
        purplePlayer: await loadImage(path.join(__dirname, '..', '..', 'assets', 'contraptions', 'purple.png')),
    };

    const greenContraption = createContraption(greenBuild, 'green', -200);
    const purpleContraption = createContraption(purpleBuild, 'purple', 200);
    Composite.add(engine.world, [greenContraption.composite, purpleContraption.composite]);

    const ground = Bodies.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT - 25, WORLD_WIDTH, 50, { isStatic: true, label: 'ground', collisionFilter: { category: collisionCategories.ground, mask: collisionCategories.player | collisionCategories.default | collisionCategories.debris } });
    const wallOptions = { isStatic: true, collisionFilter: ground.collisionFilter };
    const leftWall = Bodies.rectangle(-25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT, wallOptions);
    const rightWall = Bodies.rectangle(WORLD_WIDTH + 25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT, wallOptions);
    Composite.add(engine.world, [ground, leftWall, rightWall]);

    let winner: 'green' | 'purple' | null = null;
    Events.on(engine, 'collisionStart', (event) => {
        for (const pair of event.pairs) {
            const labels = [pair.bodyA.label, pair.bodyB.label];
            if (labels.includes('ground')) {
                if (labels.includes('greenPlayer')) winner = 'purple';
                if (labels.includes('purplePlayer')) winner = 'green';
            }
        }
    });

    Events.on(engine, 'beforeUpdate', () => {
        // Continuous wheel motor
        greenContraption.wheels.forEach(wheel => wheel.torque = WHEEL_SPIN_SPEED);
        purpleContraption.wheels.forEach(wheel => wheel.torque = -WHEEL_SPIN_SPEED);
        // Weld breaking
        const weldsToCheck = [...greenContraption.welds, ...purpleContraption.welds];
        for (const weld of weldsToCheck) {
            const a = Constraint.pointAWorld(weld);
            const b = Constraint.pointBWorld(weld);
            const distance = Vector.magnitude(Vector.sub(a, b));
            if (distance > PART_SIZE * 0.02) {
                Composite.remove(engine.world, weld);
            }
        }
    });

    const canvas = createCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const ctx = canvas.getContext('2d');
    const totalFrames = (SIMULATION_DURATION_MS / 1000) * FRAME_RATE;
    const timeStep = 1000 / FRAME_RATE;
    let timeSinceLastDebris = DEBRIS_SPAWN_INTERVAL_MS; // Spawn one near the start
    let simulationTime = 0;

    for (let i = 0; i < totalFrames; i++) {
        if (winner) break;
        Engine.update(engine, timeStep);
        simulationTime += timeStep;
        timeSinceLastDebris += timeStep;

        if (timeSinceLastDebris >= DEBRIS_SPAWN_INTERVAL_MS) {
            timeSinceLastDebris = 0;
            const progress = simulationTime / SIMULATION_DURATION_MS;
            const debrisX = Math.random() * (WORLD_WIDTH - 100) + 50;
            const mass = DEBRIS_MASS_START + (DEBRIS_MASS_END - DEBRIS_MASS_START) * progress;
            const velocityY = DEBRIS_VELOCITY_START + (DEBRIS_VELOCITY_END - DEBRIS_VELOCITY_START) * progress;

            const debris = Bodies.rectangle(debrisX, -50, PART_SIZE * 0.8, PART_SIZE * 0.8, {
                label: 'debris', restitution: 0.1,
                collisionFilter: { category: collisionCategories.debris, mask: collisionCategories.default | collisionCategories.ground | collisionCategories.debris }
            });
            Matter.Body.setMass(debris, mass);
            Matter.Body.setVelocity(debris, { x: (Math.random() - 0.5) * 4, y: velocityY });
            Composite.add(engine.world, debris);
        }

        ctx.fillStyle = '#35253c';
        ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        ctx.fillStyle = '#7f7384';
        ctx.fillRect(0, WORLD_HEIGHT - 50, WORLD_WIDTH, 50);

        const allBodies = Composite.allBodies(engine.world);
        for (const body of allBodies) {
            if (body.isStatic) continue;
            ctx.save();
            ctx.translate(body.position.x, body.position.y);
            ctx.rotate(body.angle);
            let image: Image | null = null;
            let drawWidth = 0, drawHeight = 0;

            if (body.label.startsWith('part_')) {
                const partType = parseInt(body.label.split('_')[1]!, 10) as PartType;
                image = assets[partType as PartType.Box | PartType.Wheel];
                drawWidth = drawHeight = partType === PartType.Wheel ? WHEEL_RADIUS * 2 : PART_SIZE;
            } else if (body.label === 'greenPlayer' || body.label === 'purplePlayer') {
                image = body.label === 'greenPlayer' ? assets.greenPlayer : assets.purplePlayer;
                drawWidth = PLAYER_HEIGHT; drawHeight = PLAYER_HEIGHT;
            } else if (body.label === 'debris') {
                ctx.fillStyle = '#a193a8';
                ctx.fillRect(-PART_SIZE * 0.4, -PART_SIZE * 0.4, PART_SIZE * 0.8, PART_SIZE * 0.8);
            }

            if (image) ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
            ctx.restore();
        }

        const allConstraints = Composite.allConstraints(engine.world);
        for (const constraint of allConstraints) {
            if (constraint.label === 'Spring') {
                const { bodyA, bodyB } = constraint;
                const midX = (bodyA!.position.x + bodyB!.position.x) / 2;
                const midY = (bodyA!.position.y + bodyB!.position.y) / 2;
                const angle = Math.atan2(bodyB!.position.y - bodyA!.position.y, bodyB!.position.x - bodyA!.position.x);
                ctx.save();
                ctx.translate(midX, midY);
                ctx.rotate(angle);
                ctx.drawImage(assets[PartType.Spring], -PART_SIZE / 2, -PART_SIZE / 2, PART_SIZE, PART_SIZE);
                ctx.restore();
            }
        }

        const frameBuffer = canvas.toBuffer('image/png');
        await fs.writeFile(path.join(frameDir, `frame_${i}.png`), frameBuffer);
        await onFrame(frameBuffer, i / totalFrames);
    }

    if (winner) {
        // --- FIX: Ensure the frame index is an integer ---
        const lastFrameIndex = Math.floor(Math.max(0, (simulationTime / timeStep) - 1));
        const lastFramePath = path.join(frameDir, `frame_${lastFrameIndex}.png`);
        const image = await loadImage(lastFramePath);
        ctx.drawImage(image, 0, 0);


        ctx.font = 'bold 80px Outfit';
        ctx.textAlign = 'center';
        const winnerText = `${winner.charAt(0).toUpperCase() + winner.slice(1)} Team Wins!`;
        const winnerColor = winner === 'green' ? '#57F287' : '#9b59b6';
        ctx.fillStyle = winnerColor;
        ctx.fillText(winnerText, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

        const finalFrameBuffer = canvas.toBuffer('image/png');
        const finalFrameIndex = Math.floor(simulationTime / timeStep);
        await fs.writeFile(path.join(frameDir, `frame_${finalFrameIndex}.png`), finalFrameBuffer);
    }
}

function createContraption(build: Build, team: 'green' | 'purple', xOffset: number) {
    const composite = Composite.create();
    const bodyGrid: (Matter.Body | null)[][] = Array.from({ length: 4 }, () => Array(5).fill(null));
    const welds: Matter.Constraint[] = [];
    const wheels: Matter.Body[] = [];

    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
            const part = build.grid[y]![x]!;
            if (part.type === PartType.Empty || part.type === PartType.Spring) continue;

            const worldX = (WORLD_WIDTH / 2) + xOffset + (x - 2.5) * PART_SIZE;
            const worldY = 200 + y * PART_SIZE;

            let body: Matter.Body | null = null;
            const defaultCollision = { category: collisionCategories.default, mask: collisionCategories.default | collisionCategories.debris | collisionCategories.ground | collisionCategories.player };

            if (part.type === PartType.Box) body = Bodies.rectangle(worldX, worldY, PART_SIZE, PART_SIZE, { label: `part_${PartType.Box}`, collisionFilter: defaultCollision });
            else if (part.type === PartType.Wheel) body = Bodies.circle(worldX, worldY, WHEEL_RADIUS, { label: `part_${PartType.Wheel}`, collisionFilter: defaultCollision });
            else if (part.type === PartType.Player) body = Bodies.rectangle(worldX, worldY, PLAYER_WIDTH, PLAYER_HEIGHT, { label: `${team}Player`, collisionFilter: { category: collisionCategories.player, mask: collisionCategories.ground | collisionCategories.default } });

            if (body) bodyGrid[y]![x] = body;
        }
    }
    Composite.add(composite, bodyGrid.flat().filter(b => b) as Matter.Body[]);

    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 5; x++) {
            const bodyA = bodyGrid[y]![x];
            const partA = build.grid[y]![x]!;

            if (partA.type === PartType.Spring) {
                const isVertical = partA.rotation === Rotation.Up || partA.rotation === Rotation.Down;
                const body1 = isVertical ? bodyGrid[y - 1]?.[x] : bodyGrid[y]?.[x - 1];
                const body2 = isVertical ? bodyGrid[y + 1]?.[x] : bodyGrid[y]?.[x + 1];
                if (body1 && body2) Composite.add(composite, Constraint.create({ label: 'Spring', bodyA: body1, bodyB: body2, stiffness: SPRING_STIFFNESS, damping: 0.05 }));
            } else if (bodyA) {
                const bodyRight = x < 4 ? bodyGrid[y]![x + 1] : null;
                const partRight = x < 4 ? build.grid[y]![x + 1] : null;
                if (bodyRight && partA.type === PartType.Box && partRight?.type === PartType.Box) {
                    const weld = Constraint.create({ bodyA, pointA: { x: PART_SIZE / 2, y: 0 }, bodyB: bodyRight, pointB: { x: -PART_SIZE / 2, y: 0 }, stiffness: 0.9, length: 0 });
                    welds.push(weld); Composite.add(composite, weld);
                }
                const bodyDown = y < 3 ? bodyGrid[y + 1]![x] : null;
                const partDown = y < 3 ? build.grid[y + 1]![x] : null;
                if (bodyDown && partA.type === PartType.Box && partDown?.type === PartType.Box) {
                    const weld = Constraint.create({ bodyA, pointA: { x: 0, y: PART_SIZE / 2 }, bodyB: bodyDown, pointB: { x: 0, y: -PART_SIZE / 2 }, stiffness: 0.9, length: 0 });
                    welds.push(weld); Composite.add(composite, weld);
                }

                if (partA.type === PartType.Wheel) {
                    wheels.push(bodyA);
                    let anchorBody: Matter.Body | null = null;
                    let pointA: Matter.Vector = { x: 0, y: 0 };
                    const neighbors = [
                        { body: y > 0 ? bodyGrid[y - 1]![x] : null, anchor: { x: 0, y: PART_SIZE } },
                        { body: y < 3 ? bodyGrid[y + 1]![x] : null, anchor: { x: 0, y: -PART_SIZE } },
                        { body: x > 0 ? bodyGrid[y]![x - 1] : null, anchor: { x: PART_SIZE, y: 0 } },
                        { body: x < 4 ? bodyGrid[y]![x + 1] : null, anchor: { x: -PART_SIZE, y: 0 } }
                    ];
                    for (const neighbor of neighbors) {
                        if (neighbor.body) {
                            // only attach to boxes and springs, NOT to wheels or players
                            // const label = neighbor.body.label;
                            // if (label === `part_${PartType.Wheel}` || label.endsWith('Player')) continue;

                            anchorBody = neighbor.body;
                            pointA = neighbor.anchor;
                            break;
                        }
                    }
                    if (anchorBody) Composite.add(composite, Constraint.create({ bodyA: anchorBody, pointA, bodyB: bodyA, pointB: { x: 0, y: 0 }, stiffness: 0.7, length: 0 }));
                }
            }
        }
    }
    return { composite, bodyGrid, welds, wheels };
}