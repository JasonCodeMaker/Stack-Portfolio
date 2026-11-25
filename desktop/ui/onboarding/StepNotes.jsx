import React from "react";
import { ChevronDown, Eye, CircleHelp } from "lucide-react";
import { Screenshots } from "./Screenshots";

export function StepNotes({ chapter }) {
  return (
    <div className="ob-step-notes">
      <div className="ob-expected">
        <Eye size={17} aria-hidden="true" />
        <div>
          <strong>操作后会看到</strong>
          <p>{chapter.check}</p>
        </div>
      </div>
      <details className="ob-help-topic">
        <summary>
          <CircleHelp size={16} aria-hidden="true" />
          {chapter.problem || "遇到问题？"}
          <ChevronDown size={15} />
        </summary>
        <p>{chapter.recovery}</p>
      </details>
    </div>
  );
}
export function FieldSource({ field, label, id }) {
  return (
    <div className="ob-field-source">
      <p id={id}>{field.hint}</p>
      {field.photo && (
        <details>
          <summary>在 IBKR 哪里找 {label}？</summary>
          <Screenshots images={[field.photo]} />
        </details>
      )}
    </div>
  );
}
