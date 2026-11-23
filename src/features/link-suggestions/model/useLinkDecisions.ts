import { useCallback, useState } from 'react';
import { api, type GraphNode, type GraphRulePattern } from '@/shared/api';
import type { Suggestion } from './suggestions';

/**
 * Accept / reject suggestions and answer rule proposals (T68). The new graph comes back through the index status
 * (no reply to wait for); only a refused `[[link]]` write is reported.
 */
export function useLinkDecisions() {
  const [insertFailed, setInsertFailed] = useState(false);

  const accept = useCallback(async (s: Suggestion, from: GraphNode, insert: boolean) => {
    const write = insert && from.path && s.linkName;
    // Written into this note, so the link goes from it.
    const [source, target] = write ? [from.id, s.other.id] : [s.edge.source, s.edge.target];
    const r = await api.graphDecide({
      source,
      target,
      accept: true,
      ...(write ? { insertInto: from.path!, linkTo: s.linkName! } : {}),
    });
    setInsertFailed(!!write && !r.inserted);
  }, []);

  const reject = useCallback(async (s: Suggestion) => {
    setInsertFailed(false);
    await api.graphDecide({ source: s.edge.source, target: s.edge.target, accept: false });
  }, []);

  return {
    insertFailed,
    accept,
    reject,
    makeRule: (pattern: GraphRulePattern) => api.graphRule({ op: 'add', pattern }),
    dismiss: (key: string) => api.graphRule({ op: 'dismiss', key }),
  };
}
