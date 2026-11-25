import React, { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { StepNotes, FieldSource } from "./StepNotes";
import { Modal } from "../common";
import { brokerNames, buildBrokerGuides, accountChapter, importChapter } from "./brokerGuide";
import { Screenshots } from "./Screenshots";
import { PhoneGuide } from "./PhoneGuide";
import { useI18n } from "../i18n.jsx";

function Tutorial({ initialBroker, initialStep, close }) {
  const { t } = useI18n();
  const [broker, setBroker] = useState(initialBroker);
  const [expanded, setExpanded] = useState(initialStep);
  const chaptersList = useRef(null);
  useEffect(() => {
    const list = chaptersList.current;
    const active = list?.children[expanded];
    if (active && list.scrollHeight > list.clientHeight) {
      list.scrollTop += active.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
    }
  }, [broker, expanded]);
  const guides = buildBrokerGuides(t);
  const chapters = [...guides[broker], accountChapter(broker, t), importChapter(broker, t)];
  function switchBroker(next) {
    if (next !== broker) {
      setBroker(next);
      setExpanded(next === initialBroker ? initialStep : 0);
    }
  }
  return (
    <Modal title={t("ob.tut.title")} close={close} wide>
      <div className="ob-manual-brokers" role="group" aria-label={t("ob.tut.brokerPickAria")}>
        {Object.entries(brokerNames).map(([id, label]) => (
          <button key={id} aria-pressed={broker === id} onClick={() => switchBroker(id)}>
            {label}
          </button>
        ))}
      </div>
      <ol ref={chaptersList} className="ob-manual-chapters">
        {chapters.map((chapter, index) => {
          const open = index === expanded;
          return (
            <li key={chapter.title}>
              <button
                className="ob-chapter-title"
                aria-expanded={open}
                aria-controls={"guide-section-" + index}
                onClick={() => setExpanded(open ? -1 : index)}
              >
                <strong>{chapter.title}</strong>
                <ChevronDown size={16} />
              </button>
              <div id={"guide-section-" + index} hidden={!open} className="ob-chapter-content">
                {open && (
                  <>
                    <p>{chapter.body}</p>
                    {chapter.visual === "phone" ? (
                      <PhoneGuide />
                    ) : (
                      <Screenshots key={broker + index} images={chapter.images} paired={chapter.paired} />
                    )}
                    {chapter.fields?.map((field, i) => (
                      <FieldSource
                        key={i}
                        field={field}
                        label={
                          (broker === "ibkr" ? ["Query ID", "Current Token"] : ["App Key", "App Secret"])[i]
                        }
                      />
                    ))}
                    <StepNotes chapter={chapter} />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="ob-manual-footer">
        <button className="ob-primary" onClick={close}>
          {t("ob.tut.backCurrent")}
        </button>
      </div>
    </Modal>
  );
}

export function TutorialLauncher({ broker, page, step = 0 }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const initialBroker = broker || "ibkr";
  const guides = buildBrokerGuides(t);
  const guideLength = guides[initialBroker].length;
  const initialStep =
    page === "guide"
      ? step
      : page === "account" || page === "bound"
        ? guideLength
        : page === "import"
          ? guideLength + 1
          : 0;
  return (
    <>
      <button className="ob-manual-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <BookOpen size={17} />
        {t("ob.tut.openBtn")}
      </button>
      {open && (
        <Tutorial initialBroker={initialBroker} initialStep={initialStep} close={() => setOpen(false)} />
      )}
    </>
  );
}
