import { Build } from './build';

export class ContraptionGame {
    public readonly playerRedId: string; // Corresponds to Green Team
    public readonly playerBlueId: string; // Corresponds to Purple Team
    public readonly redBuild: Build;
    public readonly blueBuild: Build;

    public playerRedConfirmed: boolean = false;
    public playerBlueConfirmed: boolean = false;

    constructor(playerRedId: string, playerBlueId: string) {
        this.playerRedId = playerRedId;
        this.playerBlueId = playerBlueId;
        this.redBuild = new Build();
        this.blueBuild = new Build();
    }

    // --- FIX: Confirm by role, not by player ID ---
    // This correctly handles the self-play scenario.
    public confirmRole(role: 'green' | 'purple') {
        if (role === 'green') this.playerRedConfirmed = true;
        if (role === 'purple') this.playerBlueConfirmed = true;
    }

    public areBothPlayersConfirmed(): boolean {
        return this.playerRedConfirmed && this.playerBlueConfirmed;
    }
}