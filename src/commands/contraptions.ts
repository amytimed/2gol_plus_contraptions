import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ButtonInteraction, CacheType, MessageReaction, User } from 'discord.js';
import { ContraptionGame } from '../contraptions/game';
import { BUILD_AREA_HEIGHT, BUILD_AREA_WIDTH, Build } from '../contraptions/build';
import { PartType, Rotation } from '../contraptions/types';
import { runSimulation, SIMULATION_DURATION_MS, type FrameCallback } from '../contraptions/simulation';
import { createVideo } from '../contraptions/video-renderer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';

const MAX_UPLOAD_MB = 10;


const EMOJIS = {
    [PartType.Empty]: '◼️',
    [PartType.Box]: '<:box:1421924673842708540>',
    [PartType.Wheel]: '<:wheel:1421924670843654254>',
    [PartType.Spring]: '<:spring:1421924672043487384>',
    springVertical: '<:spring_vertical:1421935123321851924>', 
    greenPlayer: '<:green:1421931814049808506>',
    purplePlayer: '<:purple:1421931815026823320>',
};

const activeContraptionGames = new Map<string, ContraptionGame>();

function buildMessageComponents(game: ContraptionGame, playerRole: 'green' | 'purple'): ActionRowBuilder<ButtonBuilder>[] {
    const build = playerRole === 'green' ? game.redBuild : game.blueBuild;
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let y = 0; y < BUILD_AREA_HEIGHT; y++) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let x = 0; x < BUILD_AREA_WIDTH; x++) {
            const part = build.grid[y]![x]!;
            let emoji = EMOJIS[part.type as Exclude<PartType, PartType.Player>];
            if (part.type === PartType.Player) {
                emoji = playerRole === 'green' ? EMOJIS.greenPlayer : EMOJIS.purplePlayer;
            } else if (part.type === PartType.Spring) {
                const isVertical = part.rotation === Rotation.Up || part.rotation === Rotation.Down;
                emoji = isVertical ? EMOJIS.springVertical : EMOJIS[PartType.Spring];
            }
            row.addComponents(
                new ButtonBuilder().setCustomId(`contraption_build_${x}_${y}`).setEmoji(emoji).setStyle(ButtonStyle.Secondary)
            );
        }
        components.push(row);
    }

    const toolbar = new ActionRowBuilder<ButtonBuilder>();
    const counts = build.partCounts;
    const createToolButton = (partType: PartType, emoji: string, label?: string) => {
        const count = counts[partType];
        const fullLabel = label ? `${label} (${count})` : `(${count})`;
        return new ButtonBuilder()
            .setCustomId(`contraption_tool_${partType}`)
            .setEmoji(emoji)
            .setLabel(fullLabel)
            .setStyle(build.selectedPart === partType ? ButtonStyle.Success : ButtonStyle.Primary)
            .setDisabled(count === 0);
    };
    toolbar.addComponents(
        createToolButton(PartType.Player, playerRole === 'green' ? EMOJIS.greenPlayer : EMOJIS.purplePlayer),
        createToolButton(PartType.Box, EMOJIS[PartType.Box]),
        createToolButton(PartType.Wheel, EMOJIS[PartType.Wheel]),
        createToolButton(PartType.Spring, EMOJIS[PartType.Spring]),
        new ButtonBuilder().setCustomId(`contraption_tool_${PartType.Empty}`).setLabel('Empty').setEmoji(EMOJIS[PartType.Empty]).setStyle(build.selectedPart === PartType.Empty ? ButtonStyle.Success : ButtonStyle.Primary)
    );
    components.push(toolbar);
    return components;
}

export const data = new SlashCommandBuilder()
    .setName('contraptions')
    .setDescription('Challenge a user to a physics-based building game.')
    .addUserOption(option =>
        option.setName('opponent').setDescription('The user you want to challenge.').setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
    const opponent = interaction.options.getUser('opponent', true);
    if (opponent.bot) {
        return interaction.reply({ content: "You cannot challenge a bot!", ephemeral: true });
    }

    const game = new ContraptionGame(interaction.user.id, opponent.id);
    activeContraptionGames.set(interaction.id, game);

    const greenMessage = (await interaction.reply({
        content: `${EMOJIS.greenPlayer} **Green Team Builder** for <@${game.playerRedId}>\nYour contraption will move to the **Right**.\nClick the ✅ reaction to confirm your build.`,
        components: buildMessageComponents(game, 'green'),
        withResponse: true,
    })).resource?.message!;
    if (!interaction.channel || !('send' in interaction.channel)) return;
    const purpleMessage = await interaction.channel.send({ content: `${EMOJIS.purplePlayer} **Purple Team Builder** for <@${game.playerBlueId}>\nYour contraption will move to the **Left**.\nClick the ✅ reaction to confirm your build.`, components: buildMessageComponents(game, 'purple') });

    await greenMessage.react('✅');
    await purpleMessage.react('✅');

    const triggerSimulationIfReady = async () => {
        const game = activeContraptionGames.get(interaction.id);
        if (!game || !game.areBothPlayersConfirmed()) return;
        greenButtonCollector.stop();
        purpleButtonCollector.stop();
        greenReactionCollector.stop();
        purpleReactionCollector.stop();
        // ... (rest of the simulation trigger logic is correct)
        const initialFrameCanvas = createCanvas(800, 600);
        const ctx = initialFrameCanvas.getContext('2d');
        ctx.fillStyle = '#35253c'; ctx.fillRect(0, 0, 800, 600);
        const initialBuffer = initialFrameCanvas.toBuffer('image/png');
        const simulationMessage = await interaction.followUp({ content: `Simulating... (0%)`, files: [new AttachmentBuilder(initialBuffer, { name: 'simulation.png' })] });
        let lastUpdateTime = 0;
        let tempDir = '';
        try {
            tempDir = path.join(__dirname, '..', '..', 'temp', uuidv4());
            await fs.mkdir(tempDir, { recursive: true });
            const onFrame: FrameCallback = async (frameBuffer, progress) => {
                const now = Date.now();
                if (now - lastUpdateTime > 1000) {
                    lastUpdateTime = now;
                    const progressPercent = Math.floor(progress * 100);
                    await simulationMessage.edit({ content: `Simulating... (${progressPercent}%)`, files: [new AttachmentBuilder(frameBuffer, { name: 'simulation.png' })] });
                }
            };
            await runSimulation(game.redBuild, game.blueBuild, onFrame, tempDir);
            await simulationMessage.edit({ content: 'Rendering video... 🎥 This may take a moment.', files: [] });
            const videoFile = path.join(tempDir, 'battle.mp4');
            const totalDurationSec = 90;
            await createVideo(tempDir, totalDurationSec, videoFile, path.join(__dirname, '..', '..', 'assets', 'contraptions', 'bad.mp3'));
            const stats = await fs.stat(videoFile);
            const fileSizeInMB = stats.size / (1024 * 1024);
            if (fileSizeInMB < MAX_UPLOAD_MB) {
                await simulationMessage.edit({ content: 'Battle finished!', files: [new AttachmentBuilder(videoFile)] });
            } else {
                await simulationMessage.edit({ content: `Battle finished! Video (${fileSizeInMB.toFixed(2)}MB) is too large to upload.`, files: [] });
            }
        } catch (e) {
            console.error("Simulation or video rendering failed:", e);
            await simulationMessage.edit({ content: 'An error occurred during simulation or video rendering. Please check the bot logs.' });
        } finally {
            activeContraptionGames.delete(interaction.id);
            if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
        }
    };

    // --- BUG FIX: Create separate, dedicated handlers for each button collector ---

    const greenButtonCollector = greenMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 600_000 });
    greenButtonCollector.on('collect', async (i: ButtonInteraction<CacheType>) => {
        const game = activeContraptionGames.get(interaction.id);
        if (!game || i.user.id !== game.playerRedId || game.playerRedConfirmed) {
            return i.deferUpdate();
        }
        const build = game.redBuild;
        const [, action, ...params] = i.customId.split('_');
        if (action === 'tool') build.handleToolbarClick(parseInt(params[0]!, 10) as PartType);
        if (action === 'build') build.handleGridClick(parseInt(params[0]!, 10), parseInt(params[1]!, 10));

        const content = `${EMOJIS.greenPlayer} **Green Team Builder** for <@${game.playerRedId}>\nYour contraption will move to the **Right**.\nClick the ✅ reaction to confirm your build.`;
        await i.update({ content, components: buildMessageComponents(game, 'green') });
    });

    const purpleButtonCollector = purpleMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 600_000 });
    purpleButtonCollector.on('collect', async (i: ButtonInteraction<CacheType>) => {
        const game = activeContraptionGames.get(interaction.id);
        if (!game || i.user.id !== game.playerBlueId || game.playerBlueConfirmed) {
            return i.deferUpdate();
        }
        const build = game.blueBuild;
        const [, action, ...params] = i.customId.split('_');
        if (action === 'tool') build.handleToolbarClick(parseInt(params[0]!, 10) as PartType);
        if (action === 'build') build.handleGridClick(parseInt(params[0]!, 10), parseInt(params[1]!, 10));

        const content = `${EMOJIS.purplePlayer} **Purple Team Builder** for <@${game.playerBlueId}>\nYour contraption will move to the **Left**.\nClick the ✅ reaction to confirm your build.`;
        await i.update({ content, components: buildMessageComponents(game, 'purple') });
    });

    // --- Reaction collector logic remains correct ---
    const greenReactionCollector = greenMessage.createReactionCollector({ filter: (reaction: MessageReaction, user: User) => reaction.emoji.name === '✅' && !user.bot && user.id === game.playerRedId, time: 600_000 });
    greenReactionCollector.on('collect', async (reaction, user) => {
        const game = activeContraptionGames.get(interaction.id);
        if (!game || game.playerRedConfirmed) return;
        if (!game.redBuild.hasPlayer()) return reaction.users.remove(user.id);
        game.confirmRole('green');
        await greenMessage.edit({ content: `${EMOJIS.greenPlayer} **Green Team Build Confirmed!**`, components: buildMessageComponents(game, 'green').map(r => { r.components.forEach(c => c.setDisabled(true)); return r; }) });
        await triggerSimulationIfReady();
    });

    const purpleReactionCollector = purpleMessage.createReactionCollector({ filter: (reaction: MessageReaction, user: User) => reaction.emoji.name === '✅' && !user.bot && user.id === game.playerBlueId, time: 600_000 });
    purpleReactionCollector.on('collect', async (reaction, user) => {
        const game = activeContraptionGames.get(interaction.id);
        if (!game || game.playerBlueConfirmed) return;
        if (!game.blueBuild.hasPlayer()) return reaction.users.remove(user.id);
        game.confirmRole('purple');
        await purpleMessage.edit({ content: `${EMOJIS.purplePlayer} **Purple Team Build Confirmed!**`, components: buildMessageComponents(game, 'purple').map(r => { r.components.forEach(c => c.setDisabled(true)); return r; }) });
        await triggerSimulationIfReady();
    });
        }