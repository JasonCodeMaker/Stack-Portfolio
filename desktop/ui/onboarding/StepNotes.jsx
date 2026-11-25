import React from "react";
import { ChevronDown, Eye, CircleHelp } from "lucide-react";
import { Screenshots } from "./Screenshots";
import { useI18n } from "../i18n.jsx";

export function StepNotes({ chapter }) {
  const { t } = useI18n();
  return (
    <div className="ob-step-notes">
      <div className="ob-expected">
        <Eye size={17} aria-hidden="true" />
        <div>
          <strong>{t("ob.notes.expectedTitle")}</strong>
          <p>{chapter.check}</p>
        </div>
      </div>
      <details className="ob-help-topic">
        <summary>
          <CircleHelp size={16} aria-hidden="true" />
          {chapter.problem || t("ob.notes.problemDefault")}
          <ChevronDown size={15} />
        </summary>
        <p>{chapter.recovery}</p>
      </details>
    </div>
  );
}
export function FieldSource({ field, label, id }) {
  const { t } = useI18n();
  return (
    <div className="ob-field-source">
      <p id={id}>{field.hint}</p>
      {field.photo && (
        <details>
          <summary>{t("ob.notes.whereToFind", { label })}</summary>
          <Screenshots images={[field.photo]} />
        </details>
      )}
    </div>
  );
}
