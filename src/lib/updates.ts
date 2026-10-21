// Whether a newer version is out. The server asks GitHub and caches the answer (see server/src/updates.ts).

import { useCallback, useState } from "react";
import { api, type UpdateStatus } from "./api";
import { invalidate, useApi } from "./hooks";

const PATH = "/updates";

export function useUpdateCheck() {
  const loaded = useApi<UpdateStatus>(PATH);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  /** Asks GitHub again, skipping the server's cache. */
  const check = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      await api<UpdateStatus>(`${PATH}?refresh=1`);
      invalidate(PATH);
      loaded.reload();
    } catch (e) {
      setCheckError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [loaded.reload]);

  const status = loaded.data;
  return {
    status,
    checking: checking || (loaded.loading && !status),
    error: checkError ?? status?.error ?? loaded.error,
    check,
  };
}

export type UpdateCheck = ReturnType<typeof useUpdateCheck>;
