export enum PartType {
    Empty,
    Box,
    Wheel,
    Spring,
    Player,
}

export type PartCounts = {
    [PartType.Box]: number;
    [PartType.Wheel]: number;
    [PartType.Spring]: number;
    [PartType.Player]: number;
};

export enum Rotation {
    Up = 0,    // 0 degrees
    Right = 90,  // 90 degrees
    Down = 180, // 180 degrees
    Left = 270,  // 270 degrees
}

export interface Part {
    type: PartType;
    rotation: Rotation;
}