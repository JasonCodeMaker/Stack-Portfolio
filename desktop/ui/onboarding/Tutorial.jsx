import React, { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown } from "lucide-react";
import { Modal } from "../common";
import { brokerNames, brokerGuides, accountChapter, importChapter } from "./brokerGuide";
import { Screenshots } from "./Screenshots";
import { PhoneGuide } from "./PhoneGuide";

function Tutorial({ initialBroker, initialStep, close }) {
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
  const chapters = [...brokerGuides[broker], accountChapter(broker), importChapter(broker)];
  function switchBroker(next) {
    if (next !== broker) {
      setBroker(next);
      setExpanded(next === initialBroker ? initialStep : 0);
    }
  }
  return (
    <Modal title="完整账户教程" close={close} wide>
      <div className="ob-manual-brokers" role="group" aria-label="选择要阅读的券商教程">
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
                <span className="ob-chapter-number">{String(index + 1).padStart(2, "0")}</span>
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
                      <Screenshots key={broker + index} images={chapter.images} />
                    )}
                    <p className="ob-checkpoint">
                      <Check size={15} />
                      {chapter.check}
                    </p>
                    <details className="ob-troubleshoot">
                      <summary>遇到问题？</summary>
                      <p>{chapter.recovery}</p>
                    </details>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="ob-manual-footer">
        <button className="ob-primary" onClick={close}>
          返回当前页面
        </button>
      </div>
    </Modal>
  );
}

export function TutorialLauncher({ broker, page, step = 0 }) {
  const [open, setOpen] = useState(false);
  const initialBroker = broker || "ibkr";
  const guideLength = brokerGuides[initialBroker].length;
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
        查看完整教程
      </button>
      {open && <Tutorial initialBroker={initialBroker} initialStep={initialStep} close={() => setOpen(false)} />}
    </>
  );
}
