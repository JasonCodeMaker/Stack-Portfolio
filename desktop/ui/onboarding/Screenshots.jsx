import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Expand, ExternalLink } from "lucide-react";
import { Modal } from "../common";

function Target({ photo }) {
  const [x, y, w, h] = photo.target;
  const above = photo.side === "above";
  const dx = above ? 0 : photo.side === "left" ? -1 : 1,
    dy = above ? -1 : 0;
  const tx = x + ((dx + 1) * w) / 2 + dx * 4,
    ty = y + ((dy + 1) * h) / 2 + dy * 4;
  const length = Math.min(photo.crop[2] * 0.12, 46);
  const tip = length * 0.27;
  const arrow =
    "M " +
    (tx + length * dx) +
    " " +
    (ty + length * dy) +
    " L " +
    tx +
    " " +
    ty +
    " m " +
    (tip * dx - tip * dy) +
    " " +
    (tip * dy + tip * dx) +
    " L " +
    tx +
    " " +
    ty +
    " l " +
    (tip * dx + tip * dy) +
    " " +
    (tip * dy - tip * dx);
  return ["halo", "ink"].map((t) => (
    <g key={t} className={"ob-mark-" + t} aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={4} vectorEffect="non-scaling-stroke" />
      <path d={arrow} vectorEffect="non-scaling-stroke" />
    </g>
  ));
}
function Frame({ photo, full = false, marks = [photo], crop = photo.crop }) {
  if (!photo.target)
    return (
      <picture>
        {photo.dark && <source media="(prefers-color-scheme: dark)" srcSet={photo.dark} />}
        <img src={photo.src} alt={photo.caption} />
      </picture>
    );
  return (
    <svg
      className="ob-focus-image"
      viewBox={(full ? [0, 0, photo.width, photo.height] : crop).join(" ")}
      role="img"
      aria-label={marks.length ? marks.map((m) => m.caption).join(" ") : photo.label}
    >
      <image href={photo.src} width={photo.width} height={photo.height} />
      {photo.dark && (
        <image className="ob-shot-dark" href={photo.dark} width={photo.width} height={photo.height} />
      )}
      {marks.map((mark) => (
        <Target key={mark.label || mark.caption} photo={mark} />
      ))}
    </svg>
  );
}
export function SourceLink({ url, children }) {
  return (
    <a className="ob-source" href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
export function Screenshots({ images, paired = false }) {
  const [index, setIndex] = useState(0),
    [open, setOpen] = useState(false);
  if (!images?.length) return null;
  const photo = images[index] || images[0],
    named = images.length > 1 && images.every((i) => i.label);
  const view = "查看完整截图";
  return (
    <figure className="ob-real-figure">
      {named && !paired && (
        <div className="ob-shot-tabs" role="group" aria-label="选择截图中的控件">
          {images.map((item, i) => (
            <button type="button" key={item.label} aria-pressed={i === index} onClick={() => setIndex(i)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="ob-screenshot"
        onClick={() => setOpen(true)}
        aria-label={view + " · " + photo.caption}
      >
        {paired ? (
          images.map((item) => (
            <div key={item.label} className="ob-paired-detail">
              <strong>{item.label}</strong>
              <Frame photo={item} />
            </div>
          ))
        ) : photo.landmark ? (
          <div className="ob-row-detail">
            <Frame photo={photo} crop={photo.landmark} marks={[]} />
            <span aria-hidden="true">…</span>
            <Frame photo={photo} />
          </div>
        ) : (
          <Frame photo={photo} />
        )}
      </button>
      <figcaption>
        <strong>
          {paired ? "两项都勾选后，滚动到弹窗底部，点「Save」。" : photo.caption}
        </strong>
        <div className="ob-figure-tools">
          <button className="ob-open-shot" type="button" onClick={() => setOpen(true)}>
            <Expand size={14} />
            {view}
          </button>
          {photo.url ? (
            <SourceLink url={photo.url}>
              {photo.source} <ExternalLink size={12} />
            </SourceLink>
          ) : (
            <small>{photo.source}</small>
          )}
          {!named && images.length > 1 && (
            <span className="ob-image-pages">
              <button aria-label="上一张截图" disabled={!index} onClick={() => setIndex(index - 1)}>
                <ChevronLeft size={15} />
              </button>
              图 {index + 1} / {images.length}
              <button
                aria-label="下一张截图"
                disabled={index === images.length - 1}
                onClick={() => setIndex(index + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </span>
          )}
        </div>
      </figcaption>
      {open && (
        <Modal title="完整截图" close={() => setOpen(false)} wide>
          <div className="ob-viewer">
            <Frame photo={photo} full marks={paired ? images : [photo]} />
          </div>
          <p>{paired ? images.map((i) => i.caption).join(" ") : photo.caption}</p>
        </Modal>
      )}
    </figure>
  );
}
