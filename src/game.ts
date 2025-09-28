import { CellState, Winner } from './types';

const GRID_SIZE = 5;
const PLACEMENTS_PER_ROUND = 3;

export class Game {
    public grid: CellState[][];
    public playerRedId: string;
    public playerBlueId: string;

    // --- FIX 1: Add non-null assertion to properties initialized in a helper method ---
    public placementsRedLeft!: number;
    public placementsBlueLeft!: number;

    public readonly isTimed: boolean;
    public playerRedReady: boolean = false;
    public playerBlueReady: boolean = false;
    public isSimulating: boolean = false;

    constructor(playerRedId: string, playerBlueId: string, isTimed: boolean) {
        this.grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(CellState.Dead));
        this.playerRedId = playerRedId;
        this.playerBlueId = playerBlueId;
        this.isTimed = isTimed;
        this.resetForNextRound();
    }

    public setPlayerReady(playerId: string) {
        if (playerId === this.playerRedId) this.playerRedReady = true;
        if (playerId === this.playerBlueId) this.playerBlueReady = true;
    }

    public areBothPlayersReady(): boolean {
        return this.playerRedReady && this.playerBlueReady;
    }

    public placeCell(x: number, y: number, playerId: string): boolean {
        if (this.grid[y]?.[x] !== CellState.Dead) return false;

        if (playerId === this.playerRedId && this.placementsRedLeft > 0) {
            this.grid[y]![x] = CellState.Red;
            this.placementsRedLeft--;
            return true;
        }

        if (playerId === this.playerBlueId && this.placementsBlueLeft > 0) {
            this.grid[y]![x] = CellState.Blue;
            this.placementsBlueLeft--;
            return true;
        }
        return false;
    }

    public isPlacementPhaseOver(): boolean {
        return this.placementsRedLeft === 0 && this.placementsBlueLeft === 0;
    }

    countNeighbors(x: number, y: number) {
        let total = 0, redCount = 0, blueCount = 0;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const nx = x + j;
                const ny = y + i;
                if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                    const neighborState = this.grid[ny]![nx];
                    if (neighborState !== CellState.Dead) {
                        total++;
                        if (neighborState === CellState.Red) redCount++;
                        if (neighborState === CellState.Blue) blueCount++;
                    }
                }
            }
        }
        return { total, redCount, blueCount };
    }

    step() {
        const nextGrid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(CellState.Dead));
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const { total, redCount, blueCount } = this.countNeighbors(x, y);
                const currentState = this.grid[y]![x];
                if (currentState !== CellState.Dead) {
                    if (total === 2 || total === 3) nextGrid[y]![x] = currentState;
                } else {
                    if (total === 3) {
                        if (redCount > 0 && blueCount > 0) nextGrid[y]![x] = CellState.Neutral;
                        else if (redCount > blueCount) nextGrid[y]![x] = CellState.Red;
                        else if (blueCount > redCount) nextGrid[y]![x] = CellState.Blue;
                        else nextGrid[y]![x] = CellState.Neutral;
                    }
                }
            }
        }
        this.grid = nextGrid;
    }

    public getWinner(): Winner {
        let redCount = 0, blueCount = 0;
        for (const row of this.grid) {
            for (const cell of row) {
                if (cell === CellState.Red) redCount++;
                if (cell === CellState.Blue) blueCount++;
            }
        }
        if (redCount > 0 && blueCount === 0) return Winner.Red;
        if (blueCount > 0 && redCount === 0) return Winner.Blue;
        if (redCount === 0 && blueCount === 0) return Winner.Draw;
        return Winner.None;
    }

    public resetForNextRound() {
        this.placementsRedLeft = PLACEMENTS_PER_ROUND;
        this.placementsBlueLeft = PLACEMENTS_PER_ROUND;
        this.playerRedReady = false;
        this.playerBlueReady = false;
    }
}