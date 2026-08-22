(() => {
  'use strict';

  const TARGET_PATH =
    /\/projects\/[^/]+\/issues(?:\/(?:new|\d+))?(?:\/|$)|\/issues\/(?:\d+(?:\/|$)|new(?:\/|$))|\/wiki(?:\/|$)|\/issues\/issue-\d+\.html(?:$|[?#])/;

  const HEADER =
    /^(sequenceDiagram|flowchart\s+(?:TD|TB|BT|LR|RL)|graph\s+(?:TD|TB|BT|LR|RL)|stateDiagram(?:-v2)?|gantt)\b/i;

  let serial = 0;
  let initScheduled = false;

  function titleFor(source) {
    const s = source.trim();

    if (/^sequenceDiagram\b/.test(s)) return 'シーケンス図';
    if (/^(?:flowchart|graph)\b/.test(s)) return 'フローチャート';
    if (/^stateDiagram/.test(s)) return '状態遷移図';
    if (/^gantt\b/i.test(s)) return 'ガントチャート';

    return 'Mermaid図';
  }
  function isMermaid(source) {
    return HEADER.test(String(source || '').trim());
  }

  function sourceFromPre(pre) {
    if (!pre || pre.closest('.rpe-sequence-diagram')) return null;
    const code = pre.querySelector(':scope > code');
    const source = (code ? code.textContent : pre.textContent || '').trim();
    return isMermaid(source) ? source : null;
  }

  function sourceFromPreview(preview) {
    if (!preview || preview.querySelector('.rpe-sequence-diagram')) return null;
    const source = (preview.innerText || preview.textContent || '').trim();
    return isMermaid(source) ? source : null;
  }
  function sourceFromSavedWiki(wiki) {
    if (!wiki || wiki.querySelector('.rpe-sequence-diagram')) return null;

    const children = Array.from(wiki.children);

    for (let i = 0; i < children.length; i += 1) {
      const header = children[i];

      if (header.tagName !== 'P') continue;

      const headerText = (header.textContent || '').trim();
      if (!isMermaid(headerText)) continue;

      const wrapper = children[i + 1];
      if (!wrapper) continue;

      let pre = null;

      if (wrapper.tagName === 'PRE') {
        pre = wrapper;
      } else {
        pre = wrapper.querySelector('pre');
      }

      if (!pre) continue;

      const bodyText = (pre.textContent || '').trim();
      if (!bodyText) continue;

      return {
        source: `${headerText}\n${bodyText}`,
        header,
        body: wrapper
      };
    }

    return null;
  }
  function componentMarkup(source) {
    return `
      <div class="rpe-sequence-header">
        <span class="rpe-sequence-title"></span>

        <div class="rpe-sequence-menu-wrap">
          <button type="button"
                  class="rpe-sequence-menu-button"
                  data-role="menu-button"
                  aria-haspopup="true">その他 ▾</button>

          <div class="rpe-sequence-menu" hidden>
            <button type="button"
                    class="rpe-sequence-menu-item"
                    data-action="toggle-options">
              プレビューオプションを表示
            </button>

            <button type="button"
                    class="rpe-sequence-menu-item"
                    data-action="toggle-source">
              Mermaidコードを表示
            </button>
          </div>
        </div>
      </div>

      <div class="rpe-sequence-layout">
        <div class="rpe-sequence-main">
          <pre class="rpe-sequence-source" hidden></pre>

          <div class="rpe-sequence-viewer">
            <div class="rpe-sequence-canvas"></div>
          </div>
        </div>

        <aside class="rpe-sequence-options" hidden>
          <div class="rpe-sequence-options-header">
            <h3 class="rpe-sequence-options-title">
              プレビューオプション
            </h3>
          </div>

          <section class="rpe-sequence-option-section">
            <h4>画面表示</h4>

            <div class="rpe-sequence-option-row rpe-sequence-zoom-row">
              <span class="rpe-sequence-field-label">ズーム</span>

              <div class="rpe-sequence-zoom-controls">
                <button type="button"
                        class="rpe-sequence-zoom-button"
                        data-action="zoom-out"
                        title="10%縮小">−</button>

                <span class="rpe-sequence-zoom-label">100%</span>

                <button type="button"
                        class="rpe-sequence-zoom-button"
                        data-action="zoom-in"
                        title="10%拡大">＋</button>
              </div>
            </div>

            <button type="button"
                    class="rpe-sequence-reset-button"
                    data-action="reset-view">
              画面表示をリセット
            </button>
          </section>

          <section class="rpe-sequence-option-section">
            <h4>画像保存</h4>

            <div class="rpe-sequence-option-row">
              <span class="rpe-sequence-field-label">幅</span>
              <input type="number"
                     min="100"
                     max="12000"
                     data-role="export-width">
              <span>px</span>
            </div>

            <div class="rpe-sequence-option-row">
              <span class="rpe-sequence-field-label">高さ</span>
              <input type="number"
                     min="100"
                     max="20000"
                     data-role="export-height">
              <span>px</span>
            </div>

            <div class="rpe-sequence-check-row">
              <input type="checkbox"
                     data-role="ratio-lock"
                     checked>
              <span>縦横比を固定</span>
            </div>

            <div class="rpe-sequence-option-row">
              <span class="rpe-sequence-field-label">JPEG品質</span>
              <input type="number"
                     min="10"
                     max="100"
                     value="90"
                     data-role="jpeg-quality">
              <span>%</span>
            </div>

            <button type="button"
                    class="rpe-sequence-reset-button"
                    data-action="reset-export">
              画像保存を初期化
            </button>

            <div class="rpe-sequence-save-buttons">
              <button type="button"
                      class="rpe-sequence-save-button"
                      data-action="export-png">PNGで保存</button>

              <button type="button"
                      class="rpe-sequence-save-button"
                      data-action="export-jpeg">JPEGで保存</button>

              <button type="button"
                      class="rpe-sequence-save-button"
                      data-action="export-svg">SVGで保存</button>
            </div>
          </section>
        </aside>
      </div>
    `;
  }
  function currentSvg(component) {
    return component.querySelector('.rpe-sequence-canvas svg');
  }

  function setZoom(component, zoom) {
    zoom = Math.max(0.1, Math.min(5, zoom));

    const svg = currentSvg(component);
    if (!svg) return;

    const label = component.querySelector('.rpe-sequence-zoom-label');

    const baseWidth = Number(component.dataset.baseWidth || 0);
    const baseHeight = Number(component.dataset.baseHeight || 0);

    if (!baseWidth || !baseHeight) return;

    component.dataset.zoom = String(zoom);

    svg.style.setProperty(
      'width',
      `${Math.round(baseWidth * zoom)}px`,
      'important'
    );

    svg.style.setProperty(
      'height',
      `${Math.round(baseHeight * zoom)}px`,
      'important'
    );

    svg.style.setProperty(
      'max-width',
      'none',
      'important'
    );

    if (label) {
      label.textContent = `${Math.round(zoom * 100)}%`;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg(component) {
    const svg = currentSvg(component);
    if (!svg) return;

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      new XMLSerializer().serializeToString(svg);

    downloadBlob(
      new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
      `mermaid-${component.dataset.diagramId}.svg`
    );
  }

  async function exportRaster(component, mimeType) {
    const svg = currentSvg(component);
    if (!svg) return;

    const widthInput =
      component.querySelector('[data-role="export-width"]');
    const heightInput =
      component.querySelector('[data-role="export-height"]');
    const qualityInput =
      component.querySelector('[data-role="jpeg-quality"]');

    const width =
      Math.max(100, Number(widthInput.value) || 1200);

    const height =
      Math.max(100, Number(heightInput.value) || 800);
    const background = '#ffffff';

    const quality =
      Math.max(
        10,
        Math.min(
          100,
          Number(qualityInput.value) || 90
        )
      ) / 100;

    try {
      const clone = svg.cloneNode(true);

      clone.setAttribute(
        'xmlns',
        'http://www.w3.org/2000/svg'
      );

      /*
       * Mermaid flowchart の文字は foreignObject の HTML ラベル。
       * SVG を Image/Canvas 化すると Chrome でも文字だけ欠落する場合があるため、
       * 保存時だけ foreignObject を通常の SVG <text> に変換する。
       */
      const originals =
        Array.from(svg.querySelectorAll('foreignObject'));

      const copies =
        Array.from(clone.querySelectorAll('foreignObject'));

      copies.forEach((foreignObject, index) => {
        const original = originals[index];
        if (!original) return;

        const labelSource =
          original.querySelector(
            '.nodeLabel, .edgeLabel, .label'
          ) || original;

        const labelClone =
          labelSource.cloneNode(true);

        /*
         * Mermaid の HTML ラベル内 <br> を
         * SVG <tspan> 用の明示的な改行へ変換する。
         */
        labelClone
          .querySelectorAll('br')
          .forEach((br) => {
            br.replaceWith(
              document.createTextNode('\n')
            );
          });

        const rawText =
          (labelClone.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .trim();

        const lines =
          rawText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        if (!lines.length) {
          foreignObject.remove();
          return;
        }

        const x =
          Number(foreignObject.getAttribute('x')) || 0;

        const y =
          Number(foreignObject.getAttribute('y')) || 0;

        const w =
          Number(foreignObject.getAttribute('width')) || 0;

        const h =
          Number(foreignObject.getAttribute('height')) || 0;

        const label =
          original.querySelector(
            '.nodeLabel, .edgeLabel, .label, span, div'
          ) || original;

        const style =
          window.getComputedStyle(label);

        const fontSize =
          parseFloat(style.fontSize) || 16;

        const lineHeight =
          fontSize * 1.35;

        const text =
          document.createElementNS(
            'http://www.w3.org/2000/svg',
            'text'
          );

        text.setAttribute(
          'x',
          String(x + (w / 2))
        );

        text.setAttribute(
          'y',
          String(y + (h / 2))
        );

        text.setAttribute(
          'text-anchor',
          'middle'
        );

        text.setAttribute(
          'dominant-baseline',
          'middle'
        );

        text.setAttribute(
          'font-size',
          String(fontSize)
        );

        text.setAttribute(
          'font-family',
          style.fontFamily ||
          'Arial, Noto Sans JP, Yu Gothic, sans-serif'
        );

        if (style.fontWeight) {
          text.setAttribute(
            'font-weight',
            style.fontWeight
          );
        }

        text.setAttribute(
          'fill',
          style.color || '#333333'
        );

        lines.forEach((line, lineIndex) => {
          const tspan =
            document.createElementNS(
              'http://www.w3.org/2000/svg',
              'tspan'
            );

          tspan.setAttribute(
            'x',
            String(x + (w / 2))
          );

          if (lineIndex === 0) {
            tspan.setAttribute(
              'dy',
              String(
                -((lines.length - 1) * lineHeight) / 2
              )
            );
          } else {
            tspan.setAttribute(
              'dy',
              String(lineHeight)
            );
          }

          tspan.textContent = line;
          text.appendChild(tspan);
        });

        foreignObject.replaceWith(text);
      });

      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        new XMLSerializer().serializeToString(clone);

      const blob =
        new Blob(
          [xml],
          { type: 'image/svg+xml;charset=utf-8' }
        );

      const url =
        URL.createObjectURL(blob);

      const image =
        new Image();

      image.onload = () => {
        const canvas =
          document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;

        const ctx =
          canvas.getContext('2d');

        if (!ctx) {
          URL.revokeObjectURL(url);
          return;
        }

        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(
          image,
          0,
          0,
          width,
          height
        );

        URL.revokeObjectURL(url);

        canvas.toBlob(
          (result) => {
            if (!result) return;

            const ext =
              mimeType === 'image/jpeg'
                ? 'jpg'
                : 'png';

            downloadBlob(
              result,
              `mermaid-${component.dataset.diagramId}.${ext}`
            );
          },
          mimeType,
          mimeType === 'image/jpeg'
            ? quality
            : undefined
        );
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);

        console.error(
          'Mermaid export SVG could not be loaded.'
        );
      };

      image.src = url;
    }
    catch (error) {
      console.error(
        'Mermaid raster export failed:',
        error
      );
    }
  }
  function wireComponent(component) {
    const menuButton =
      component.querySelector('[data-role="menu-button"]');
    const menu =
      component.querySelector('.rpe-sequence-menu');
    const options =
      component.querySelector('.rpe-sequence-options');
    const source =
      component.querySelector('.rpe-sequence-source');

    menuButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
    });

    component
      .querySelector('[data-action="toggle-options"]')
      ?.addEventListener('click', () => {
        options.hidden = !options.hidden;
        menu.hidden = true;
      });

    component
      .querySelector('[data-action="toggle-source"]')
      ?.addEventListener('click', () => {
        source.hidden = !source.hidden;
        menu.hidden = true;
      });

    component
      .querySelector('[data-action="zoom-in"]')
      ?.addEventListener('click', () => {
        setZoom(component, Number(component.dataset.zoom || 1) + 0.1);
      });

    component
      .querySelector('[data-action="zoom-out"]')
      ?.addEventListener('click', () => {
        setZoom(component, Number(component.dataset.zoom || 1) - 0.1);
      });

    component
      .querySelector('[data-action="zoom-reset"]')
      ?.addEventListener('click', () => setZoom(component, 1));

    component
      .querySelector('[data-action="reset-view"]')
      ?.addEventListener('click', () => setZoom(component, 1));

    component
      .querySelector('[data-action="export-svg"]')
      ?.addEventListener('click', () => exportSvg(component));

    component
      .querySelector('[data-action="export-png"]')
      ?.addEventListener('click', () =>
        exportRaster(component, 'image/png')
      );

    component
      .querySelector('[data-action="export-jpeg"]')
      ?.addEventListener('click', () =>
        exportRaster(component, 'image/jpeg')
      );

    const bg =
      component.querySelector('[data-role="export-background"]');
    const bgText =
      component.querySelector('[data-role="export-background-text"]');

    bg?.addEventListener('input', () => {
      if (bgText) bgText.textContent = bg.value;
    });

    document.addEventListener('click', () => {
      if (menu) menu.hidden = true;
    });
  }

  async function renderTarget(target, source) {
    serial += 1;

    const component = document.createElement('section');

    component.className =
      'rpe-sequence-diagram rpe-mermaid-diagram';

    component.dataset.diagramId = String(serial);
    component.dataset.zoom = '1';

    component.innerHTML =
      componentMarkup(source);

    component
      .querySelector('.rpe-sequence-title')
      .textContent = titleFor(source);

    component
      .querySelector('.rpe-sequence-source')
      .textContent = source;

    target.replaceWith(component);

    const canvas =
      component.querySelector('.rpe-sequence-canvas');

    try {
      const id =
        `rpe-mermaid-${Date.now()}-${serial}`;

      const result =
        await window.mermaid.render(id, source);

      canvas.innerHTML = result.svg;

      if (typeof result.bindFunctions === 'function') {
        result.bindFunctions(canvas);
      }

      const svg =
        currentSvg(component);

      if (svg) {
        const viewBox =
          svg.viewBox?.baseVal;

        const width =
          viewBox?.width ||
          Number(svg.getAttribute('width')) ||
          1200;

        const height =
          viewBox?.height ||
          Number(svg.getAttribute('height')) ||
          800;

        component.dataset.baseWidth =
          String(width);

        component.dataset.baseHeight =
          String(height);

        component
          .querySelector('[data-role="export-width"]')
          .value = Math.round(width);

        component
          .querySelector('[data-role="export-height"]')
          .value = Math.round(height);

        setZoom(component, 1);
      }
    }
    catch (error) {
      canvas.textContent =
        `Mermaid図を表示できませんでした。\n${error.message}`;
    }

    wireComponent(component);
  }
  function initMermaidTargets() {
    if (!TARGET_PATH.test(location.pathname)) return;
    if (!window.mermaid) return;

    document.querySelectorAll('pre').forEach((pre) => {
      const source = sourceFromPre(pre);
      if (source) renderTarget(pre, source);
    });

    document.querySelectorAll('.wiki-preview').forEach((preview) => {
      if (preview.querySelector('.rpe-sequence-diagram')) return;

      const source = sourceFromPreview(preview);
      if (!source) return;

      const holder = document.createElement('div');
      preview.replaceChildren(holder);
      renderTarget(holder, source);
    });

    document.querySelectorAll('.wiki').forEach((wiki) => {
      const saved = sourceFromSavedWiki(wiki);
      if (!saved) return;

      const holder = document.createElement('div');

      saved.header.replaceWith(holder);
      saved.body.remove();

      renderTarget(holder, saved.source);
    });
  }

  function scheduleInit() {
    if (initScheduled) return;

    initScheduled = true;

    requestAnimationFrame(() => {
      initScheduled = false;
      initMermaidTargets();
    });
  }

  function startObserver() {
    if (!document.body ||
        document.body.dataset.rpeMermaidObserver === '1') {
      return;
    }

    document.body.dataset.rpeMermaidObserver = '1';

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.addedNodes.length > 0)) {
        scheduleInit();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function boot() {
    if (!window.mermaid) return;

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      htmlLabels: true,
      themeVariables: {
        fontFamily: 'Arial, "Noto Sans JP", "Yu Gothic", sans-serif',
        fontSize: '16px'
      },
      flowchart: {
        useMaxWidth: false,
        wrappingWidth: 280
      },
      sequence: {
        useMaxWidth: false
      }
    });

    scheduleInit();
    startObserver();
  }

  document.addEventListener('DOMContentLoaded', boot);
  document.addEventListener('turbo:load', boot);

  if (document.readyState !== 'loading') {
    boot();
  }
})();
