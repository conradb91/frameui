import type { z } from 'zod';
import type { flowSchema, interactionSchema, prototypeSchema, targetSchema, scenarioSchema } from '../../core/prototype/schema';
import type { VisualDocument } from './visualDesign';
export type PrototypeData = z.infer<typeof prototypeSchema>;
export type PrototypeFlow = z.infer<typeof flowSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type PrototypeTarget = z.infer<typeof targetSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type DraftStatus = 'generating' | 'review' | 'revising' | 'ready' | 'approved' | 'imported' | 'discarded' | 'failed';
export interface PrototypeDraft {
    design?: import('../aiDesign').AiDesignSettings;
    version: 1;
    id: string;
    documentId: string;
    target: PrototypeTarget;
    sourceRevision: string;
    approvedVersionId?:string;
    base: VisualDocument;
    versions: {
        id: string;
        createdAt: string;
        document: VisualDocument;
        message: string;
        source?: 'ai'|'manual'|'checkpoint';
        approvedAt?:string;
        design?: import('../aiDesign').AiDesignSettings;
        designReview?:import('../../core/ai/designContext').DesignReview;
    }[];
    currentVersion: number;
    conversation: {
        role: 'user' | 'assistant';
        content: string;
        reference?: string;
    }[];
    status: DraftStatus;
    createdAt: string;
    updatedAt: string;
    error?: string;
}
export interface PrototypeApi {
    accept(id:string):Promise<PrototypeDraft>;
    importApproved(id:string):Promise<VisualDocument>;
    checkpoint(id:string,name:string):Promise<PrototypeDraft>;
    fork(id:string):Promise<PrototypeDraft>;
    exportHandoff(id:string,notes:string):Promise<{ok:boolean;filePath?:string;screens?:number;warnings?:string[]}>;
    save(id: string, document: VisualDocument): Promise<PrototypeDraft>;
    list(documentId: string): Promise<PrototypeDraft[]>;
    load(id: string): Promise<PrototypeDraft>;
    discard(id: string): Promise<void>;
    restore(id: string, version: number): Promise<PrototypeDraft>;
    approve(id: string): Promise<VisualDocument>;
}
