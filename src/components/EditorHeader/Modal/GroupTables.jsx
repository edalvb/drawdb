import { useState } from "react";
import {
  Button,
  Checkbox,
  Slider,
  Spin,
  Toast,
  Typography,
} from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { MODAL } from "../../../data/constants";
import {
  useAreas,
  useDiagram,
  useSettings,
  useUndoRedo,
} from "../../../hooks";
import { applyGrouping, groupTablesIntelligently } from "../../../utils/grouping";

export default function GroupTables({ setModal }) {
  const { t } = useTranslation();
  const { tables, relationships, setTables } = useDiagram();
  const { areas, setAreas } = useAreas();
  const { settings } = useSettings();
  const { setUndoStack, setRedoStack } = useUndoRedo();

  const maxGroups = Math.max(2, tables.length);
  const [groups, setGroups] = useState(
    Math.min(maxGroups, Math.max(2, Math.round(tables.length / 4) || 2)),
  );
  const [useSemantic, setUseSemantic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const onProgress = (p) => {
    if (p.phase === "model") setStatus(t("downloading_model"));
    else if (p.phase === "embedding") setStatus(t("computing_embeddings"));
    else if (p.phase === "clustering") setStatus(t("grouping_tables"));
  };

  const run = async () => {
    if (tables.length < 2) {
      Toast.warning(t("not_enough_tables"));
      return;
    }
    setLoading(true);
    try {
      const result = await groupTablesIntelligently(tables, relationships, {
        useSemantic,
        targetGroups: groups,
        settings,
        onProgress,
      });

      const { newTables, newAreas, undoEntry } = applyGrouping(
        result,
        tables,
        areas,
        t("group_tables"),
      );
      setTables(newTables);
      setAreas(newAreas);
      setUndoStack((prev) => [...prev, undoEntry]);
      setRedoStack([]);

      Toast.success(t("grouping_done"));
      setModal(MODAL.NONE);
    } catch (e) {
      console.error(e);
      Toast.error(t("grouping_failed"));
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <div>
      <Typography.Paragraph type="tertiary">
        {t("group_tables_desc")}
      </Typography.Paragraph>

      <div className="my-4">
        <div className="font-semibold mb-1">
          {t("number_of_groups")}: {groups}
        </div>
        <Slider
          min={2}
          max={maxGroups}
          value={groups}
          onChange={setGroups}
          disabled={loading}
        />
      </div>

      <Checkbox
        checked={useSemantic}
        onChange={(e) => setUseSemantic(e.target.checked)}
        disabled={loading}
      >
        {t("use_semantic_grouping")}
      </Checkbox>
      <div className="text-xs text-gray-400 mt-1">{t("semantic_model_note")}</div>

      {loading && (
        <div className="flex items-center gap-2 mt-4 text-sky-600">
          <Spin />
          <span>{status || t("grouping_tables")}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Button onClick={() => setModal(MODAL.NONE)} disabled={loading}>
          {t("cancel")}
        </Button>
        <Button theme="solid" onClick={run} loading={loading}>
          {t("group_tables")}
        </Button>
      </div>
    </div>
  );
}
