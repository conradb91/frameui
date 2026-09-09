import type { DesignTreeRecord } from '@shared/types/designTreeRecord'
import { getDesignTreesFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

export type { DesignTreeRecord }

function readAll(userDataPath: string, projectId: string): DesignTreeRecord[] {
  return readJsonFile<DesignTreeRecord[]>(getDesignTreesFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, records: DesignTreeRecord[]): void {
  writeJsonFileAtomic(getDesignTreesFile(userDataPath, projectId), records)
}

export function getDesignTree(userDataPath: string, projectId: string, ownerId: string): DesignTreeRecord | null {
  return readAll(userDataPath, projectId).find((r) => r.ownerId === ownerId) ?? null
}

export function saveDesignTree(userDataPath: string, record: DesignTreeRecord): DesignTreeRecord {
  const records = readAll(userDataPath, record.projectId)
  const saved: DesignTreeRecord = { ...record, updatedAt: new Date().toISOString() }
  const index = records.findIndex((r) => r.ownerId === record.ownerId)
  if (index === -1) records.push(saved)
  else records[index] = saved
  writeAll(userDataPath, record.projectId, records)
  return saved
}

export function deleteDesignTree(userDataPath: string, projectId: string, ownerId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((r) => r.ownerId !== ownerId))
}
