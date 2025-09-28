import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import * as twoGolCommand from './commands/2gol';
import * as contraptionsCommand from './commands/contraptions';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessageReactions] });

const commands = new Collection<string, any>();
commands.set(twoGolCommand.data.name, twoGolCommand);
commands.set(contraptionsCommand.data.name, contraptionsCommand);


client.once(Events.ClientReady, () => {
    console.log('Bot is online!');
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});


client.login(process.env.TOKEN);