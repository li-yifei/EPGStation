import * as apid from '../../../../../../api';

export interface SelectorItem {
    text: string;
    value: number;
}

export interface VideoFileItem {
    parentDirectoryName: string | undefined;
    subDirectory: string | null;
    viewName: string | null;
    fileType: string | undefined;
    file: File | null;
}

export interface IRecordedUploadState {
    ruleId: apid.RuleId | null | undefined;
    channelId: apid.ChannelId | undefined;
    startAt: Date | null;
    duration: number | null;
    name: string | null;
    description: string | null;
    extended: string | null;
    genre1: apid.ProgramGenreLv1 | undefined;
    subGenre1: apid.ProgramGenreLv2 | undefined;
    videoFileItems: VideoFileItem[];
    init(): void;
    fetchData(): Promise<void>;
    updateRuleItems(): Promise<void>;
    getChannelItems(): SelectorItem[];
    getPrentDirectoryItems(): string[];
    getFileTypeItems(): apid.VideoFileType[];
    getGenreItems(): SelectorItem[];
    getSubGenreItems(): SelectorItem[];
    addEmptyVideoFileItem(): void;
    upload(): Promise<void>;
}