import crypto from 'node:crypto'
import type { Flow, FlowSummary } from '@shared/types/flow'
import { toFlowSummary } from '@shared/types/flow'
import { getFlowsFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

function readAll(userDataPath: string, projectId: string): Flow[] {
  return readJsonFile<Flow[]>(getFlowsFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, flows: Flow[]): void {
  writeJsonFileAtomic(getFlowsFile(userDataPath, projectId), flows)
}

export function listFlows(userDataPath: string, projectId: string): FlowSummary[] {
  return readAll(userDataPath, projectId)
    .map(toFlowSummary)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** Full `Flow` objects (not summaries) for every flow in a project — used
 * by featureStore's cascade delete, which needs each flow's node list. */
export function listFlowsFull(userDataPath: string, projectId: string): Flow[] {
  return readAll(userDataPath, projectId)
}

export function getFlow(userDataPath: string, projectId: string, flowId: string): Flow | null {
  return readAll(userDataPath, projectId).find((f) => f.id === flowId) ?? null
}

export function createFlow(userDataPath: string, projectId: string, name: string, description: string, featureId: string | null = null): Flow {
  const now = new Date().toISOString()
  const flow: Flow = {
    id: crypto.randomUUID(),
    projectId,
    featureId,
    name,
    description,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  }
  const flows = readAll(userDataPath, projectId)
  flows.push(flow)
  writeAll(userDataPath, projectId, flows)
  return flow
}

/** Replaces the stored flow with `updated` (matched by id), stamping a
 * fresh updatedAt. Throws if the flow doesn't exist — callers always save
 * a flow they first loaded via getFlow/createFlow. */
export function saveFlow(userDataPath: string, updated: Flow): Flow {
  const flows = readAll(userDataPath, updated.projectId)
  const index = flows.findIndex((f) => f.id === updated.id)
  if (index === -1) {
    throw new Error(`Flow ${updated.id} not found in project ${updated.projectId}`)
  }
  const saved: Flow = { ...updated, updatedAt: new Date().toISOString() }
  flows[index] = saved
  writeAll(userDataPath, updated.projectId, flows)
  return saved
}

export function deleteFlow(userDataPath: string, projectId: string, flowId: string): void {
  const flows = readAll(userDataPath, projectId).filter((f) => f.id !== flowId)
  writeAll(userDataPath, projectId, flows)
}
