import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Modal } from "../common";

function Frame({ photo }) {
  return (
    <picture>
      {photo.dark && <source media="(prefers-color-scheme: dark)" srcSet={photo.dark} />}
      <img src={photo.src} alt={photo.caption} />
    </picture>
  );
}
export function SourceLink({ url, children }) {
  return (
    <a className="ob-source" href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
export function Screenshots({ images }) {
  const [index, setIndex] = useState(0),
    [zoom, setZoom] = useState(false),
    [original, setOriginal] = useState(false);
  const photo = images[index] || images[0];
  return (
    <figure className="ob-real-figure">
      <button
        className="ob-screenshot"
        aria-label={"放大截图 · " + photo.caption}
        onClick={() => {
          setOriginal(false);
          setZoom(true);
        }}
      >
        <Frame photo={photo} />
        <span>
          <Expand size={14} />
          放大
        </span>
      </button>
      <figcaption>
        <strong>{photo.caption}</strong>
        <div className="ob-figure-tools">
          {photo.url ? <SourceLink url={photo.url}>{photo.source} ↗</SourceLink> : <small>{photo.source}</small>}
          {images.length > 1 && (
            <span className="ob-image-pages">
              <button aria-label="上一张截图" disabled={!index} onClick={() => setIndex(index - 1)}>
                <ChevronLeft size={15} />
              </button>
              {index + 1} / {images.length}
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
      {zoom && (
        <Modal title="查看界面原图" close={() => setZoom(false)} wide>
          <div className={"ob-viewer" + (original ? " original" : "")}>
            <Frame photo={photo} />
          </div>
          <p>{photo.caption}</p>
          <button onClick={() => setOriginal(!original)}>{original ? "适应窗口" : "原始尺寸"}</button>
        </Modal>
      )}
    </figure>
  );
}
