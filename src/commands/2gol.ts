import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import type { Message, ChatInputCommandInteraction } from 'discord.js';
import { Game } from '../game';
import { CellState, Winner } from '../types';

const activeGames = new Map<string, Game>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function buildGridComponents(game: Game, disabled: boolean): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let y = 0; y < 5; y++) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let x = 0; x < 5; x++) {
            const cell = game.grid[y]![x];
            let style = ButtonStyle.Secondary;
            let isCellDisabled = disabled || cell !== CellState.Dead;
            switch (cell) {
                case CellState.Red: style = ButtonStyle.Danger; break;
                case CellState.Blue: style = ButtonStyle.Primary; break;
                case CellState.Neutral: style = ButtonStyle.Success; break;
            }
            row.addComponents(
                new ButtonBuilder().setCustomId(`2gol_${x}_${y}`).setLabel('\u200B').setStyle(style).setDisabled(isCellDisabled)
            );
        }
        rows.push(row);
    }
    return rows;
}

function getPlacementStatusText(game: Game, endTime?: number): string {
    const header = `🔴 <@${game.playerRedId}> vs 🔵 <@${game.playerBlueId}>`;
    const placementInfo = `🔴 Placements left: ${game.placementsRedLeft} | 🔵 Placements left: ${game.placementsBlueLeft}`;
    const timer = endTime ? `Placement ends <t:${endTime}:R>` : 'Place your cells!';
    return `${header}\n${placementInfo}\n${timer}`;
}

function getReadyStatusText(game: Game): string {
    const playerRedStatus = game.playerRedReady ? '✅ Ready' : '⬜ Waiting...';
    const playerBlueStatus = game.playerBlueReady ? '✅ Ready' : '⬜ Waiting...';
    return `🔴 <@${game.playerRedId}>: ${playerRedStatus}\n🔵 <@${game.playerBlueId}>: ${playerBlueStatus}\nBoth players must ready up to start the round.`;
}

async function runSimulation(message: Message, game: Game) {
    // The initial "Simulating..." message is now sent from the collector
    for (let i = 0; i < 3; i++) {
        await sleep(1000);
        game.step();
        const winner = game.getWinner();
        if (winner !== Winner.None) {
            let winMessage = '';
            if (winner === Winner.Red) winMessage = `🔴 <@${game.playerRedId}> wins! 🔴`;
            else if (winner === Winner.Blue) winMessage = `🔵 <@${game.playerBlueId}> wins! 🔵`;
            else winMessage = 'Stalemate! Both sides were eliminated.';

            await message.edit({ content: winMessage, components: buildGridComponents(game, true) });
            activeGames.delete(message.id);
            return;
        }
        await message.edit({ components: buildGridComponents(game, true) });
    }

    await sleep(1000);
    game.resetForNextRound();
    game.isSimulating = false; // Allow new interactions

    if (game.isTimed) {
        await message.edit({
            content: getReadyStatusText(game),
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('2gol_ready').setLabel('Ready').setStyle(ButtonStyle.Success)
            )]
        });
    } else {
        await message.edit({
            content: getPlacementStatusText(game),
            components: buildGridComponents(game, false),
        });
    }
}

export const data = new SlashCommandBuilder()
    .setName('2gol')
    .setDescription('Challenge a user to a 5x5 game of colorful Conway\'s Game of Life.')
    .addUserOption(option =>
        option.setName('opponent').setDescription('The user you want to challenge.').setRequired(true))
    .addBooleanOption(option =>
        option.setName('timed').setDescription('Enable a 10-second placement timer for each round.').setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
    const opponent = interaction.options.getUser('opponent', true);
    const isTimed = interaction.options.getBoolean('timed') ?? false;

    if (opponent.bot || opponent.id === interaction.user.id) {
        return interaction.reply({ content: "You cannot challenge a bot or yourself!", ephemeral: true });
    }

    const game = new Game(interaction.user.id, opponent.id, isTimed);
    let initialContent: string;
    let initialComponents: ActionRowBuilder<ButtonBuilder>[];

    if (isTimed) {
        initialContent = getReadyStatusText(game);
        initialComponents = [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('2gol_ready').setLabel('Ready').setStyle(ButtonStyle.Success)
        )];
    } else {
        initialContent = getPlacementStatusText(game);
        initialComponents = buildGridComponents(game, false);
    }

    const reply = await interaction.reply({ content: initialContent, components: initialComponents, fetchReply: true });
    activeGames.set(reply.id, game);

    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 600_000 });

    collector.on('collect', async i => {
        const gameInstance = activeGames.get(i.message.id);
        if (!gameInstance) return i.update({ content: 'This game has ended.', components: [] });

        const presserId = i.user.id;
        if (presserId !== gameInstance.playerRedId && presserId !== gameInstance.playerBlueId) {
            return i.reply({ content: "You are not a player in this game!", ephemeral: true });
        }

        // Prevent interactions while simulation is running
        if (gameInstance.isSimulating) {
            return i.deferUpdate();
        }

        if (i.customId === '2gol_ready') {
            gameInstance.setPlayerReady(presserId);
            if (gameInstance.areBothPlayersReady()) {
                const endTime = Math.floor(Date.now() / 1000) + 10;
                await i.update({
                    content: getPlacementStatusText(gameInstance, endTime),
                    components: buildGridComponents(gameInstance, false)
                });
                setTimeout(() => {
                    const currentGame = activeGames.get(reply.id);
                    if (currentGame && !currentGame.isSimulating) {
                        // Set simulating flag and update message before starting
                        currentGame.isSimulating = true;
                        reply.edit({
                            content: 'Simulating...',
                            components: buildGridComponents(currentGame, true)
                        }).then(() => runSimulation(reply, currentGame));
                    }
                }, 10_000);
            } else {
                await i.update({ content: getReadyStatusText(gameInstance) });
            }
        } else { // Grid button press
            const [, xStr, yStr] = i.customId.split('_');
            const x = parseInt(xStr!, 10);
            const y = parseInt(yStr!, 10);

            if (!gameInstance.placeCell(x, y, presserId)) {
                return i.reply({ content: "You can't place a cell there or you're out of placements!", ephemeral: true });
            }

            if (gameInstance.isPlacementPhaseOver()) {
                gameInstance.isSimulating = true;
                await i.update({
                    content: 'Simulating...',
                    components: buildGridComponents(gameInstance, true)
                });
                runSimulation(i.message, gameInstance);
            } else {
                const currentContent = i.message.content;
                const match = currentContent.match(/<t:(\d+):R>/);
                const endTime = match ? parseInt(match[1]!, 10) : undefined;
                await i.update({ content: getPlacementStatusText(gameInstance, endTime), components: buildGridComponents(gameInstance, false) });
            }
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && activeGames.has(reply.id)) {
            reply.edit({ content: 'Game timed out.', components: [] });
            activeGames.delete(reply.id);
        }
    });
}