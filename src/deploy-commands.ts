import { REST, Routes } from 'discord.js';
import * as twoGolCommand from './commands/2gol';
import * as contraptionsCommand from './commands/contraptions';

const commands = [twoGolCommand.data.toJSON(),
    contraptionsCommand.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN!);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();