import { Part, PartType, Rotation, PartCounts } from './types';

export const BUILD_AREA_WIDTH = 5;
export const BUILD_AREA_HEIGHT = 4;

const INITIAL_PART_COUNTS: PartCounts = {
    [PartType.Box]: 4,
    [PartType.Wheel]: 10,
    [PartType.Spring]: 10,
    [PartType.Player]: 1,
    [PartType.Empty]: Infinity,
};

export class Build {
    public grid: Part[][];
    public selectedPart: PartType = PartType.Box;
    public partCounts: PartCounts;

    constructor() {
        this.grid = Array.from({ length: BUILD_AREA_HEIGHT }, () =>
            Array.from({ length: BUILD_AREA_WIDTH }, () => ({
                type: PartType.Empty,
                rotation: Rotation.Up,
            }))
        );
        this.partCounts = { ...INITIAL_PART_COUNTS };
    }

    // --- FEATURE: Public method to check for a player piece ---
    public hasPlayer(): boolean {
        // Scans the entire grid to see if a Player part exists.
        return this.grid.flat().some(part => part.type === PartType.Player);
    }

    private canPlace(partType: PartType): boolean {
        if (partType === PartType.Empty) return true;
        return this.partCounts[partType] > 0;
    }

    public handleToolbarClick(part: PartType) {
        if (!this.canPlace(part)) return;
        this.selectedPart = part;
    }

    public handleGridClick(x: number, y: number) {
        const currentPart = this.grid[y]![x]!;
        const placingNewPart = currentPart.type !== this.selectedPart;

        if (placingNewPart) {
            if (!this.canPlace(this.selectedPart)) return;
            if (currentPart.type !== PartType.Empty) {
                this.partCounts[currentPart.type]++;
            }
            this.partCounts[this.selectedPart]--;
        } else {
            if (currentPart.type !== PartType.Empty && this.selectedPart !== PartType.Spring) {
                this.partCounts[currentPart.type]++;
            }
        }

        if (currentPart.type === this.selectedPart) {
            switch (currentPart.type) {
                case PartType.Player:
                case PartType.Box:
                case PartType.Wheel:
                    currentPart.type = PartType.Empty;
                    currentPart.rotation = Rotation.Up;
                    break;
                case PartType.Spring:
                    currentPart.rotation = (currentPart.rotation + 90) % 360;
                    break;
            }
        } else {
            currentPart.type = this.selectedPart;
            currentPart.rotation = this.selectedPart === PartType.Spring ? Rotation.Right : Rotation.Up;
        }
    }
}