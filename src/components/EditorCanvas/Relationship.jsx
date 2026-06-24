import { memo, useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import { Cardinality, ObjectType, Tab } from "../../data/constants";
import { calcPath, calcCompositePath } from "../../utils/calcPath";
import { useDiagram, useSettings, useLayout, useSelect } from "../../hooks";
import { useTranslation } from "react-i18next";
import { SideSheet } from "@douyinfe/semi-ui";
import RelationshipInfo from "../EditorSidePanel/RelationshipsTab/RelationshipInfo";
import {
  getVisibleFieldIndex,
  getVisibleFields,
  getRelationshipFields,
} from "../../utils/utils";

const labelFontSize = 16;
const cardinalityOffset = 28;

function Relationship({ data }) {
  const { settings } = useSettings();
  const { tablesById, relationships } = useDiagram();
  const { layout } = useLayout();
  const { selectedElement, setSelectedElement } = useSelect();
  const { t } = useTranslation();

  // Resolve only the two tables this relationship connects (O(1) lookups).
  // Keying the derived values on these specific tables means moving an
  // unrelated table doesn't recompute this relationship's path.
  const startTable = tablesById.get(data.startTableId);
  const endTable = tablesById.get(data.endTableId);

  const pathValues = useMemo(() => {
    if (!startTable || !endTable || startTable.hidden || endTable.hidden)
      return null;

    const startFields = getVisibleFields(startTable, relationships);
    const endFields = getVisibleFields(endTable, relationships);

    const pairs = getRelationshipFields(data);

    return {
      startFieldIndex: getVisibleFieldIndex(
        startTable,
        data.startFieldId,
        relationships,
      ),
      endFieldIndex: getVisibleFieldIndex(
        endTable,
        data.endFieldId,
        relationships,
      ),
      startFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(startTable, p.startFieldId, relationships),
      ),
      endFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(endTable, p.endFieldId, relationships),
      ),
      startTable: {
        x: startTable.x,
        y: startTable.y,
        comment: startTable.comment,
        fields: startFields,
      },
      endTable: {
        x: endTable.x,
        y: endTable.y,
        comment: endTable.comment,
        fields: endFields,
      },
    };
  }, [startTable, endTable, relationships, data]);

  const isComposite = (pathValues?.startFieldIndices?.length ?? 0) > 1;

  const composite = useMemo(() => {
    if (!pathValues || !isComposite) return null;
    return calcCompositePath(
      {
        startTable: pathValues.startTable,
        endTable: pathValues.endTable,
        startFieldIndices: pathValues.startFieldIndices,
        endFieldIndices: pathValues.endFieldIndices,
      },
      settings.tableWidth,
      1,
      settings.showComments,
    );
  }, [pathValues, isComposite, settings.tableWidth, settings.showComments]);

  // The SVG "d" string is identical for the visible path and the invisible
  // wide hover path, so compute it once per render.
  const pathString = useMemo(() => {
    if (!pathValues) return "";
    return composite
      ? composite.path
      : calcPath(pathValues, settings.tableWidth, 1, settings.showComments);
  }, [pathValues, composite, settings.tableWidth, settings.showComments]);

  const pathRef = useRef();
  const labelRef = useRef();

  // Label/cardinality placement needs the rendered path geometry
  // (getTotalLength/getPointAtLength) and the label's measured size. Reading
  // those during render would force a synchronous reflow on every render; doing
  // it in a layout effect keeps the path off the render-time critical path and
  // only recomputes when the geometry actually changes.
  const [geometry, setGeometry] = useState(null);

  useLayoutEffect(() => {
    if (!pathValues) {
      setGeometry(null);
      return;
    }

    const labelBBox = labelRef.current?.getBBox();
    const labelWidth = labelBBox?.width ?? 0;
    const labelHeight = labelBBox?.height ?? 0;

    if (composite) {
      setGeometry({
        labelX: composite.labelPoint.x - labelWidth / 2,
        labelY: composite.labelPoint.y + labelHeight / 2,
        cardinalityStartX: composite.startCardinality.x,
        cardinalityStartY: composite.startCardinality.y,
        cardinalityEndX: composite.endCardinality.x,
        cardinalityEndY: composite.endCardinality.y,
      });
      return;
    }

    const pathElm = pathRef.current;
    if (!pathElm) return;

    const pathLength = pathElm.getTotalLength();
    const labelPoint = pathElm.getPointAtLength(pathLength / 2);
    const point1 = pathElm.getPointAtLength(cardinalityOffset);
    const point2 = pathElm.getPointAtLength(pathLength - cardinalityOffset);

    setGeometry({
      labelX: labelPoint.x - labelWidth / 2,
      labelY: labelPoint.y + labelHeight / 2,
      cardinalityStartX: point1.x,
      cardinalityStartY: point1.y,
      cardinalityEndX: point2.x,
      cardinalityEndY: point2.y,
    });
  }, [
    pathValues,
    pathString,
    composite,
    data.name,
    settings.showRelationshipLabels,
    settings.showCardinality,
  ]);

  let cardinalityStart = "1";
  let cardinalityEnd = "1";

  switch (data.cardinality) {
    // the translated values are to ensure backwards compatibility
    case t(Cardinality.MANY_TO_ONE):
    case Cardinality.MANY_TO_ONE:
      cardinalityStart = data.manyLabel || "n";
      cardinalityEnd = "1";
      break;
    case t(Cardinality.ONE_TO_MANY):
    case Cardinality.ONE_TO_MANY:
      cardinalityStart = "1";
      cardinalityEnd = data.manyLabel || "n";
      break;
    case t(Cardinality.ONE_TO_ONE):
    case Cardinality.ONE_TO_ONE:
      cardinalityStart = "1";
      cardinalityEnd = "1";
      break;
    default:
      break;
  }

  const edit = () => {
    if (!layout.sidebar) {
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
    } else {
      setSelectedElement((prev) => ({
        ...prev,
        currentTab: Tab.RELATIONSHIPS,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
      if (selectedElement.currentTab !== Tab.RELATIONSHIPS) return;
      document
        .getElementById(`scroll_ref_${data.id}`)
        .scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!pathValues) return null;

  return (
    <>
      <g className="select-none group" onDoubleClick={edit}>
        {/* invisible wider path for better hover ux */}
        <path
          d={pathString}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          cursor="pointer"
        />
        <path
          ref={pathRef}
          d={pathString}
          className="relationship-path"
          fill="none"
          cursor="pointer"
        />
        {settings.showRelationshipLabels && (
          <text
            x={geometry?.labelX ?? 0}
            y={geometry?.labelY ?? 0}
            fill={settings.mode === "dark" ? "lightgrey" : "#333"}
            fontSize={labelFontSize}
            fontWeight={500}
            ref={labelRef}
            className="group-hover:fill-sky-600"
          >
            {data.name}
          </text>
        )}
        {geometry && settings.showCardinality && (
          <>
            <CardinalityLabel
              x={geometry.cardinalityStartX}
              y={geometry.cardinalityStartY}
              text={cardinalityStart}
            />
            <CardinalityLabel
              x={geometry.cardinalityEndX}
              y={geometry.cardinalityEndY}
              text={cardinalityEnd}
            />
          </>
        )}
      </g>
      <SideSheet
        title={t("edit")}
        size="small"
        visible={
          selectedElement.element === ObjectType.RELATIONSHIP &&
          selectedElement.id === data.id &&
          selectedElement.open &&
          !layout.sidebar
        }
        onCancel={() => {
          setSelectedElement((prev) => ({
            ...prev,
            open: false,
          }));
        }}
        style={{ paddingBottom: "16px" }}
      >
        <div className="sidesheet-theme">
          <RelationshipInfo data={data} />
        </div>
      </SideSheet>
    </>
  );
}

export default memo(Relationship);

function CardinalityLabel({ x, y, text, r = 12, padding = 14 }) {
  const [textWidth, setTextWidth] = useState(0);
  const textRef = useRef(null);

  useEffect(() => {
    if (textRef.current) {
      const bbox = textRef.current.getBBox();
      setTextWidth(bbox.width);
    }
  }, [text]);

  return (
    <g>
      <rect
        x={x - textWidth / 2 - padding / 2}
        y={y - r}
        rx={r}
        ry={r}
        width={textWidth + padding}
        height={r * 2}
        fill="grey"
        className="group-hover:fill-sky-600"
      />
      <text
        ref={textRef}
        x={x}
        y={y}
        fill="white"
        strokeWidth="0.5"
        textAnchor="middle"
        alignmentBaseline="middle"
      >
        {text}
      </text>
    </g>
  );
}
