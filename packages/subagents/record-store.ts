import { formatRecordChoices } from "./format.ts";
import {
  loadPersistedSubagentRecords,
  persistSubagentRecord,
  prunePersistedRecords,
} from "./persistence.ts";
import { isActiveStatus, isVisibleInWidget } from "./status-widget.ts";
import type { SubagentRecord, SubagentRole } from "./types.ts";

// Activity updates fire on nearly every streamed session event, so they are
// coalesced into a single debounced write instead of touching disk per event.
// Important transitions (creation, status changes, shutdown) persist eagerly.
const ACTIVITY_PERSIST_DEBOUNCE_MS = 1_000;

export type RecordLookup = { record?: SubagentRecord; error?: string };

/**
 * In-memory owner of all sub-agent records: id allocation, lookups/queries used
 * by the command and tool layers, recovery loading, and persistence scheduling.
 * Pulling this out of the extension body keeps the logic unit-testable without a
 * live Pi session.
 */
export class SubagentStore {
  private readonly records = new Map<string, SubagentRecord>();
  private readonly loadedPersistedCwds = new Set<string>();
  private readonly rolesByName: Map<string, SubagentRole>;
  private readonly pendingPersist = new Set<string>();
  private nextSubagentNumber = 1;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(rolesByName: Map<string, SubagentRole>) {
    this.rolesByName = rolesByName;
  }

  get(id: string): SubagentRecord | undefined {
    return this.records.get(id);
  }

  values(): IterableIterator<SubagentRecord> {
    return this.records.values();
  }

  sorted(): SubagentRecord[] {
    return [...this.records.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  active(): SubagentRecord[] {
    return this.sorted().filter((record) => isActiveStatus(record.status));
  }

  waitingFeedback(): SubagentRecord[] {
    return this.active().filter((record) => record.pendingFeedback);
  }

  visibleInWidget(now = Date.now()): SubagentRecord[] {
    return this.sorted().filter((record) => isVisibleInWidget(record, now));
  }

  nextId(): string {
    return `sa-${this.nextSubagentNumber++}`;
  }

  add(record: SubagentRecord): void {
    this.records.set(record.id, record);
    this.persistNow(record);
    // The run count only grows when a record is created, so prune here rather
    // than on every persist.
    prunePersistedRecords();
  }

  ensurePersistedLoaded(cwd: string): void {
    if (this.loadedPersistedCwds.has(cwd)) {
      return;
    }
    this.loadedPersistedCwds.add(cwd);
    for (const record of loadPersistedSubagentRecords(this.rolesByName, { cwd })) {
      this.records.set(record.id, record);
      this.trackNextNumber(record.id);
    }
  }

  find(query: string): RecordLookup {
    const id = query.trim();
    if (!id) {
      return { error: "Sub-agent id is required." };
    }

    const exact = this.records.get(id);
    if (exact) {
      return { record: exact };
    }

    const matches = [...this.records.values()].filter((record) => record.id.startsWith(id));
    if (matches.length === 1) {
      return { record: matches[0] };
    }
    if (matches.length > 1) {
      return { error: `Sub-agent id "${id}" is ambiguous.` };
    }
    return { error: `Sub-agent "${id}" was not found.` };
  }

  resolveSingle(
    id: string | undefined,
    candidates: SubagentRecord[],
    emptyMessage: string,
    multipleMessage: string,
  ): RecordLookup {
    const trimmedId = id?.trim();
    if (trimmedId) {
      return this.find(trimmedId);
    }
    if (candidates.length === 0) {
      return { error: emptyMessage };
    }
    if (candidates.length > 1) {
      return { error: `${multipleMessage}: ${formatRecordChoices(candidates)}.` };
    }
    return { record: candidates[0] };
  }

  /** Writes the record immediately and clears any debounced write for it. */
  persistNow(record: SubagentRecord): void {
    this.pendingPersist.delete(record.id);
    persistSubagentRecord(record);
  }

  /** Coalesces frequent activity updates into one delayed write. */
  scheduleActivityPersist(record: SubagentRecord): void {
    this.pendingPersist.add(record.id);
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPending();
    }, ACTIVITY_PERSIST_DEBOUNCE_MS);
  }

  /** Flushes any debounced writes; called on shutdown so final state survives. */
  flushPending(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    for (const id of this.pendingPersist) {
      const record = this.records.get(id);
      if (record) {
        persistSubagentRecord(record);
      }
    }
    this.pendingPersist.clear();
  }

  private trackNextNumber(id: string): void {
    const match = /^sa-(\d+)$/u.exec(id);
    if (!match) {
      return;
    }
    this.nextSubagentNumber = Math.max(this.nextSubagentNumber, Number(match[1]) + 1);
  }
}
