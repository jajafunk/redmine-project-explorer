(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const TARGET_PATH = /\/issues\/(?:\d+(?:\/|$)|new(?:\/|$))|\/wiki(?:\/|$)|\/issues\/issue-\d+\.html(?:$|[?#])/;
  let diagramSerial = 0;

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function svgElement(name, attrs = {}, text = null) {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    });
    if (text !== null) el.textContent = String(text);
    return el;
  }

  function splitMarkupLines(text) {
    return String(text)
      .split(/<br\s*\/?\s*>/i)
      .map((line) => line.trim())
      .filter((line, index, arr) => line.length > 0 || arr.length === 1);
  }

  function estimateWidth(text, fontSize = 14) {
    let units = 0;
    for (const ch of String(text)) {
      units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.58;
    }
    return Math.max(30, units * fontSize);
  }

  function addMultilineText(parent, x, y, lines, options = {}) {
    const fontSize = options.fontSize || 14;
    const lineHeight = options.lineHeight || Math.round(fontSize * 1.35);
    const anchor = options.anchor || 'middle';
    const weight = options.weight || '400';
    const fill = options.fill || '#24292f';
    const text = svgElement('text', {
      x,
      y,
      'text-anchor': anchor,
      'font-size': fontSize,
      'font-family': options.fontFamily || 'Arial, "Noto Sans JP", sans-serif',
      'font-weight': weight,
      fill
    });

    lines.forEach((line, index) => {
      const tspan = svgElement('tspan', {
        x,
        dy: index === 0 ? 0 : lineHeight
      }, line);
      text.appendChild(tspan);
    });

    parent.appendChild(text);
    return text;
  }

  function parseSequence(source) {
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    const first = lines.findIndex((line) => line.trim().length > 0);
    if (first < 0 || lines[first].trim() !== 'sequenceDiagram') {
      throw new Error('sequenceDiagram で始まるMermaidシーケンス図ではありません。');
    }

    const participants = [];
    const participantMap = new Map();
    const events = [];
    const stack = [];

    function ensureParticipant(id, label = id) {
      if (!participantMap.has(id)) {
        const participant = { id, label };
        participantMap.set(id, participant);
        participants.push(participant);
      } else if (label && label !== id) {
        participantMap.get(id).label = label;
      }
      return participantMap.get(id);
    }

    for (let i = first + 1; i < lines.length; i += 1) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line || line.startsWith('%%')) continue;

      let match = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i);
      if (match) {
        ensureParticipant(match[1], (match[2] || match[1]).trim());
        continue;
      }

      match = line.match(/^Note\s+(over|right of|left of)\s+([A-Za-z0-9_.-]+)(?:\s*,\s*([A-Za-z0-9_.-]+))?\s*:\s*(.+)$/i);
      if (match) {
        ensureParticipant(match[2]);
        if (match[3]) ensureParticipant(match[3]);
        events.push({
          type: 'note',
          placement: match[1].toLowerCase(),
          from: match[2],
          to: match[3] || match[2],
          text: match[4]
        });
        continue;
      }

      match = line.match(/^([A-Za-z0-9_.-]+?)\s*(-->>|->>|-->|->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);
      if (match) {
        ensureParticipant(match[1]);
        ensureParticipant(match[3]);
        events.push({
          type: 'message',
          from: match[1],
          to: match[3],
          arrow: match[2],
          text: match[4]
        });
        continue;
      }

      match = line.match(/^(alt|opt|loop|par|critical|break)\s*(.*)$/i);
      if (match) {
        const fragment = {
          type: 'fragmentStart',
          kind: match[1].toLowerCase(),
          label: (match[2] || '').trim()
        };
        stack.push(fragment.kind);
        events.push(fragment);
        continue;
      }

      match = line.match(/^(else|and)\s*(.*)$/i);
      if (match && stack.length) {
        events.push({
          type: 'fragmentElse',
          kind: stack[stack.length - 1],
          label: (match[2] || '').trim()
        });
        continue;
      }

      if (/^end$/i.test(line) && stack.length) {
        events.push({ type: 'fragmentEnd', kind: stack.pop() });
        continue;
      }

      match = line.match(/^(activate|deactivate)\s+([A-Za-z0-9_.-]+)$/i);
      if (match) {
        ensureParticipant(match[2]);
        events.push({ type: match[1].toLowerCase(), participant: match[2] });
        continue;
      }

      // Mermaid directives and unsupported lines are shown as a neutral note rather than silently disappearing.
      events.push({ type: 'raw', text: line });
    }

    if (!participants.length) {
      throw new Error('participant またはメッセージを確認できません。');
    }

    return { participants, events };
  }

  function renderSequence(source) {
    const model = parseSequence(source);
    const participantCount = model.participants.length;
    const participantSpacing = Math.max(190, Math.min(245, 1240 / Math.max(participantCount - 1, 1)));
    const participantBoxWidth = Math.min(175, participantSpacing - 20);
    // Keep participant boxes and fragment labels inside the SVG viewBox.
    // v3.3.1 used marginX=78, which could place the first participant and
    // fragment labels at a negative x coordinate and clip their left edge.
    const marginX = Math.max(112, Math.ceil(participantBoxWidth / 2) + 24);
    const participantBoxHeight = 48;
    const topY = 20;
    const lifelineTop = topY + participantBoxHeight;
    const eventStartY = 105;
    const bottomBoxGap = 38;
    const xById = new Map();
    const participantIndex = new Map();

    model.participants.forEach((participant, index) => {
      const x = marginX + (index * participantSpacing);
      xById.set(participant.id, x);
      participantIndex.set(participant.id, index);
    });

    const width = Math.max(
      720,
      (marginX * 2) + ((participantCount - 1) * participantSpacing)
    );

    let y = eventStartY;
    const laidOut = [];
    const fragmentStack = [];
    const fragments = [];

    model.events.forEach((event) => {
      if (event.type === 'message') {
        const self = event.from === event.to;
        const h = self ? 66 : 52;
        laidOut.push({ ...event, y, h });
        y += h;
        return;
      }

      if (event.type === 'note') {
        const noteLines = splitMarkupLines(event.text);
        const h = Math.max(50, 24 + (noteLines.length * 18));
        laidOut.push({ ...event, y, h, noteLines });
        y += h + 8;
        return;
      }

      if (event.type === 'fragmentStart') {
        const fragment = {
          kind: event.kind,
          label: event.label,
          y1: y,
          separators: []
        };
        fragmentStack.push(fragment);
        fragments.push(fragment);
        y += 38;
        return;
      }

      if (event.type === 'fragmentElse') {
        const fragment = fragmentStack[fragmentStack.length - 1];
        if (fragment) {
          fragment.separators.push({ y, label: event.label, marker: event.type });
          y += 34;
        }
        return;
      }

      if (event.type === 'fragmentEnd') {
        const fragment = fragmentStack.pop();
        if (fragment) {
          fragment.y2 = y + 10;
          y += 22;
        }
        return;
      }

      if (event.type === 'activate' || event.type === 'deactivate') {
        laidOut.push({ ...event, y, h: 20 });
        y += 20;
        return;
      }

      if (event.type === 'raw') {
        laidOut.push({ ...event, y, h: 44 });
        y += 48;
      }
    });

    while (fragmentStack.length) {
      const fragment = fragmentStack.pop();
      fragment.y2 = y + 10;
    }

    const bottomY = y + bottomBoxGap;
    const height = bottomY + participantBoxHeight + 20;
    const svg = svgElement('svg', {
      xmlns: NS,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'シーケンス図',
      'data-rpe-natural-width': width,
      'data-rpe-natural-height': height,
      preserveAspectRatio: 'xMidYMin meet'
    });

    const defs = svgElement('defs');
    const marker = svgElement('marker', {
      id: `rpe-arrow-${diagramSerial}`,
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse'
    });
    marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#344054' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const background = svgElement('rect', {
      x: 0,
      y: 0,
      width,
      height,
      fill: '#ffffff'
    });
    svg.appendChild(background);

    const fragmentLayer = svgElement('g', { class: 'rpe-sequence-fragments' });
    const lifelineLayer = svgElement('g', { class: 'rpe-sequence-lifelines' });
    const messageLayer = svgElement('g', { class: 'rpe-sequence-messages' });
    const participantLayer = svgElement('g', { class: 'rpe-sequence-participants' });

    fragments.forEach((fragment) => {
      const y2 = fragment.y2 || (bottomY - 10);
      const x = 16;
      const fragmentWidth = width - 32;
      fragmentLayer.appendChild(svgElement('rect', {
        x,
        y: fragment.y1,
        width: fragmentWidth,
        height: Math.max(40, y2 - fragment.y1),
        rx: 3,
        fill: '#fbfcff',
        stroke: '#b8c4d6',
        'stroke-width': 1
      }));

      const tagText = fragment.kind;
      const tagWidth = Math.max(42, estimateWidth(tagText, 12) + 18);
      fragmentLayer.appendChild(svgElement('path', {
        d: `M ${x} ${fragment.y1} H ${x + tagWidth} L ${x + tagWidth - 10} ${fragment.y1 + 22} H ${x} Z`,
        fill: '#eef3ff',
        stroke: '#b8c4d6',
        'stroke-width': 1
      }));
      addMultilineText(fragmentLayer, x + 8, fragment.y1 + 15, [tagText], {
        anchor: 'start',
        fontSize: 12,
        weight: '700',
        fill: '#344054'
      });
      if (fragment.label) {
        addMultilineText(fragmentLayer, x + tagWidth + 12, fragment.y1 + 17, [`[${fragment.label}]`], {
          anchor: 'start',
          fontSize: 13,
          weight: '600'
        });
      }

      fragment.separators.forEach((separator) => {
        fragmentLayer.appendChild(svgElement('line', {
          x1: x,
          y1: separator.y,
          x2: x + fragmentWidth,
          y2: separator.y,
          stroke: '#c6ced9',
          'stroke-width': 1,
          'stroke-dasharray': '4 3'
        }));
        if (separator.label) {
          const label = `[${separator.label}]`;
          const labelWidth = estimateWidth(label, 13) + 16;
          fragmentLayer.appendChild(svgElement('rect', {
            x: x + 4,
            y: separator.y - 13,
            width: labelWidth,
            height: 22,
            rx: 3,
            fill: '#ffffff'
          }));
          addMultilineText(fragmentLayer, x + 10, separator.y + 3, [label], {
            anchor: 'start',
            fontSize: 13,
            weight: '600'
          });
        }
      });
    });

    model.participants.forEach((participant) => {
      const x = xById.get(participant.id);
      lifelineLayer.appendChild(svgElement('line', {
        x1: x,
        y1: lifelineTop,
        x2: x,
        y2: bottomY,
        stroke: '#c4cbd4',
        'stroke-width': 1.2
      }));
    });

    laidOut.forEach((event) => {
      if (event.type === 'message') {
        const fromX = xById.get(event.from);
        const toX = xById.get(event.to);
        const dashed = event.arrow.startsWith('--');
        const lineY = event.y + 25;
        const labelLines = splitMarkupLines(event.text);

        if (event.from === event.to) {
          const loopWidth = 55;
          messageLayer.appendChild(svgElement('path', {
            d: `M ${fromX} ${lineY - 10} h ${loopWidth} v 28 h -${loopWidth}`,
            fill: 'none',
            stroke: '#344054',
            'stroke-width': 1.4,
            'stroke-dasharray': dashed ? '5 4' : null,
            'marker-end': `url(#rpe-arrow-${diagramSerial})`
          }));
          addMultilineText(messageLayer, fromX + (loopWidth / 2), lineY - 15, labelLines, {
            fontSize: 13
          });
        } else {
          messageLayer.appendChild(svgElement('line', {
            x1: fromX,
            y1: lineY,
            x2: toX,
            y2: lineY,
            stroke: '#344054',
            'stroke-width': 1.4,
            'stroke-dasharray': dashed ? '5 4' : null,
            'marker-end': `url(#rpe-arrow-${diagramSerial})`
          }));
          addMultilineText(messageLayer, (fromX + toX) / 2, lineY - 9, labelLines, {
            fontSize: 13
          });
        }
        return;
      }

      if (event.type === 'note') {
        const fromX = xById.get(event.from);
        const toX = xById.get(event.to);
        const center = (fromX + toX) / 2;
        const maxText = Math.max(...event.noteLines.map((line) => estimateWidth(line, 13)), 80);
        const noteWidth = Math.min(315, Math.max(150, maxText + 24));
        const noteHeight = Math.max(44, 22 + (event.noteLines.length * 18));
        let noteX = center - (noteWidth / 2);

        if (event.placement === 'right of') {
          noteX = fromX + 18;
        } else if (event.placement === 'left of') {
          noteX = fromX - noteWidth - 18;
        }

        noteX = Math.max(8, Math.min(width - noteWidth - 8, noteX));
        const noteY = event.y + 4;
        messageLayer.appendChild(svgElement('rect', {
          x: noteX,
          y: noteY,
          width: noteWidth,
          height: noteHeight,
          rx: 3,
          fill: '#fff6bf',
          stroke: '#d6b84a',
          'stroke-width': 1
        }));
        addMultilineText(messageLayer, noteX + (noteWidth / 2), noteY + 19, event.noteLines, {
          fontSize: 13,
          lineHeight: 17
        });
        return;
      }

      if (event.type === 'raw') {
        const lines = splitMarkupLines(event.text);
        const rawWidth = Math.min(width - 60, Math.max(220, estimateWidth(event.text, 12) + 20));
        const rawX = (width - rawWidth) / 2;
        messageLayer.appendChild(svgElement('rect', {
          x: rawX,
          y: event.y,
          width: rawWidth,
          height: 34,
          rx: 4,
          fill: '#f7f7f7',
          stroke: '#d0d5dd'
        }));
        addMultilineText(messageLayer, width / 2, event.y + 21, lines, {
          fontSize: 12,
          fill: '#667085'
        });
      }
    });

    function participantBox(participant, boxY) {
      const x = xById.get(participant.id);
      const group = svgElement('g');
      group.appendChild(svgElement('rect', {
        x: x - (participantBoxWidth / 2),
        y: boxY,
        width: participantBoxWidth,
        height: participantBoxHeight,
        rx: 5,
        fill: '#f2f4f7',
        stroke: '#c7ced8',
        'stroke-width': 1
      }));
      const labelLines = splitMarkupLines(participant.label.replace(/\s+as\s+/i, ' '));
      const lines = labelLines.length > 1 ? labelLines : [participant.label];
      addMultilineText(group, x, boxY + 28, lines, {
        fontSize: 13,
        weight: '600'
      });
      return group;
    }

    model.participants.forEach((participant) => {
      participantLayer.appendChild(participantBox(participant, topY));
      participantLayer.appendChild(participantBox(participant, bottomY));
    });

    svg.appendChild(fragmentLayer);
    svg.appendChild(lifelineLayer);
    svg.appendChild(messageLayer);
    svg.appendChild(participantLayer);

    return { svg, width, height };
  }

  function sourceFromPre(pre) {
    if (!pre || pre.closest('.rpe-sequence-diagram')) return null;
    const code = pre.querySelector(':scope > code');
    const text = (code ? code.textContent : pre.textContent || '').trim();
    if (!/^sequenceDiagram\b/.test(text)) return null;

    const classText = `${pre.className || ''} ${code?.className || ''}`.toLowerCase();
    if (classText.includes('mermaid') || /^sequenceDiagram\b/.test(text)) return text;
    return null;
  }

  function currentSvg(component) {
    return component.querySelector('.rpe-sequence-canvas svg');
  }

  function setSvgScale(component, scale) {
    const svg = currentSvg(component);
    if (!svg) return;
    const canvas = component.querySelector('.rpe-sequence-canvas');
    const label = component.querySelector('.rpe-sequence-zoom-label');
    component.dataset.zoom = String(scale);
    canvas.style.width = `${Math.round(scale * 100)}%`;
    svg.style.width = '100%';
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
  }

  function svgWithExportSize(svg, width, height, background) {
    const clone = svg.cloneNode(true);
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.setAttribute('viewBox', svg.getAttribute('viewBox'));
    clone.style.width = '';
    clone.style.height = '';

    const bg = clone.querySelector(':scope > rect');
    if (bg) bg.setAttribute('fill', background || '#ffffff');
    return clone;
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
    const { width, height, background } = exportSettings(component);
    const clone = svgWithExportSize(svg, width, height, background);
    const xml = new XMLSerializer().serializeToString(clone);
    downloadBlob(
      new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml;charset=utf-8' }),
      `sequence-diagram-${component.dataset.diagramId}.svg`
    );
  }

  function exportSettings(component) {
    const widthInput = component.querySelector('[data-role="export-width"]');
    const heightInput = component.querySelector('[data-role="export-height"]');
    const backgroundInput = component.querySelector('[data-role="export-background"]');
    const width = Math.max(100, Math.min(12000, Number(widthInput.value) || 1000));
    const height = Math.max(100, Math.min(20000, Number(heightInput.value) || 1000));
    const background = backgroundInput.value || '#ffffff';
    return { width, height, background };
  }

  function exportRaster(component, mimeType) {
    const svg = currentSvg(component);
    if (!svg) return;
    const settings = exportSettings(component);
    const qualityInput = component.querySelector('[data-role="jpeg-quality"]');
    const quality = Math.max(0.1, Math.min(1, (Number(qualityInput.value) || 90) / 100));
    const clone = svgWithExportSize(svg, settings.width, settings.height, settings.background);
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = settings.width;
        canvas.height = settings.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = settings.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((out) => {
          if (!out) {
            alert('画像の生成に失敗しました。解像度を小さくして再度お試しください。');
            return;
          }
          const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
          downloadBlob(out, `sequence-diagram-${component.dataset.diagramId}.${ext}`);
        }, mimeType, mimeType === 'image/jpeg' ? quality : undefined);
      } catch (error) {
        URL.revokeObjectURL(url);
        alert(`画像保存に失敗しました。\n${error.message}`);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      alert('SVGから画像への変換に失敗しました。');
    };
    image.src = url;
  }

  function syncExportSize(component, force = false) {
    const svg = currentSvg(component);
    if (!svg) return;
    const widthInput = component.querySelector('[data-role="export-width"]');
    const heightInput = component.querySelector('[data-role="export-height"]');
    const viewer = component.querySelector('.rpe-sequence-viewer');
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const fallbackWidth = Math.max(100, Math.round(viewer.clientWidth - 24));
    const displayWidth = Math.max(100, Math.round(rect.width || fallbackWidth));
    const ratio = viewBox.width > 0 ? viewBox.height / viewBox.width : 1;
    const displayHeight = Math.max(100, Math.round(displayWidth * ratio));

    if (force || !component.dataset.exportSizeInitialized) {
      widthInput.value = displayWidth;
      heightInput.value = displayHeight;
      component.dataset.exportSizeInitialized = '1';
      component.dataset.exportRatio = String(ratio);
    }
  }

  function wireComponent(component) {
    const menuButtons = Array.from(component.querySelectorAll('[data-role="menu-button"]'));
    const menus = Array.from(component.querySelectorAll('.rpe-sequence-menu'));
    const optionToggles = Array.from(component.querySelectorAll('[data-action="toggle-options"]'));
    const sourceToggles = Array.from(component.querySelectorAll('[data-action="toggle-source"]'));
    const options = component.querySelector('.rpe-sequence-options');
    const viewer = component.querySelector('.rpe-sequence-viewer');
    const widthInput = component.querySelector('[data-role="export-width"]');
    const heightInput = component.querySelector('[data-role="export-height"]');
    const ratioLock = component.querySelector('[data-role="ratio-lock"]');
    const sourceBox = component.querySelector('.rpe-sequence-source');
    const backgroundInput = component.querySelector('[data-role="export-background"]');
    const backgroundText = component.querySelector('[data-role="export-background-text"]');
    const qualityInput = component.querySelector('[data-role="jpeg-quality"]');

    function closeMenus(except = null) {
      menus.forEach((menu) => {
        if (menu !== except) menu.hidden = true;
      });
    }

    function syncMenuLabels() {
      optionToggles.forEach((button) => {
        button.textContent = options.hidden
          ? 'プレビューオプションを表示'
          : 'プレビューオプションを隠す';
      });
      sourceToggles.forEach((button) => {
        button.textContent = sourceBox.hidden ? 'Mermaidコードを表示' : 'Mermaidコードを隠す';
      });
    }

    menuButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const wrap = button.closest('.rpe-sequence-menu-wrap');
        const menu = wrap ? wrap.querySelector('.rpe-sequence-menu') : null;
        if (!menu) return;
        const willOpen = menu.hidden;
        closeMenus(menu);
        menu.hidden = !willOpen;
      });
    });

    menus.forEach((menu) => menu.addEventListener('click', (event) => event.stopPropagation()));

    optionToggles.forEach((button) => {
      button.addEventListener('click', () => {
        options.hidden = !options.hidden;
        component.classList.toggle('rpe-options-open', !options.hidden);
        syncMenuLabels();
        closeMenus();
        if (!options.hidden) requestAnimationFrame(() => syncExportSize(component, false));
      });
    });

    sourceToggles.forEach((button) => {
      button.addEventListener('click', () => {
        sourceBox.hidden = !sourceBox.hidden;
        syncMenuLabels();
        closeMenus();
      });
    });

    function applyZoom(scale, resetPosition = false) {
      const normalized = Math.max(0.5, Math.min(3, Math.round(scale * 10) / 10));
      setSvgScale(component, normalized);

      const zoomed = Math.abs(normalized - 1) > 0.001;
      viewer.classList.toggle('rpe-zoom-enabled', zoomed);
      viewer.classList.toggle('rpe-scroll-enabled', zoomed);

      if (!zoomed || resetPosition) {
        viewer.scrollTop = 0;
        viewer.scrollLeft = 0;
      }
    }

    component.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
      const current = Number(component.dataset.zoom || 1);
      applyZoom(current - 0.1);
    });

    component.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
      const current = Number(component.dataset.zoom || 1);
      applyZoom(current + 0.1);
    });

    component.querySelector('[data-action="zoom-reset"]').addEventListener('click', () => {
      applyZoom(1, true);
    });

    widthInput.addEventListener('input', () => {
      if (!ratioLock.checked) return;
      const ratio = Number(component.dataset.exportRatio || 1);
      const width = Number(widthInput.value);
      if (width > 0) heightInput.value = Math.max(1, Math.round(width * ratio));
    });

    heightInput.addEventListener('input', () => {
      if (!ratioLock.checked) return;
      const ratio = Number(component.dataset.exportRatio || 1);
      const height = Number(heightInput.value);
      if (height > 0 && ratio > 0) widthInput.value = Math.max(1, Math.round(height / ratio));
    });

    backgroundInput.addEventListener('input', () => {
      backgroundText.textContent = backgroundInput.value || '#ffffff';
    });

    component.querySelector('[data-action="export-png"]').addEventListener('click', () => exportRaster(component, 'image/png'));
    component.querySelector('[data-action="export-jpeg"]').addEventListener('click', () => exportRaster(component, 'image/jpeg'));
    component.querySelector('[data-action="export-svg"]').addEventListener('click', () => exportSvg(component));

    component.querySelector('[data-action="reset-export"]').addEventListener('click', () => {
      ratioLock.checked = true;
      backgroundInput.value = '#ffffff';
      backgroundText.textContent = '#ffffff';
      qualityInput.value = '90';
      syncExportSize(component, true);
    });

    component.querySelector('[data-action="reset-view"]').addEventListener('click', () => {
      applyZoom(1, true);
    });

    document.addEventListener('click', (event) => {
      if (!component.contains(event.target)) closeMenus();
    });

    syncMenuLabels();
    requestAnimationFrame(() => syncExportSize(component, true));
  }

  function componentMarkup(source, id) {
    const menuMarkup = `
      <div class="rpe-sequence-menu-wrap">
        <button type="button" class="rpe-sequence-menu-button" data-role="menu-button" aria-haspopup="true">その他 ▾</button>
        <div class="rpe-sequence-menu" hidden>
          <button type="button" class="rpe-sequence-menu-item" data-action="toggle-options">プレビューオプションを表示</button>
          <button type="button" class="rpe-sequence-menu-item" data-action="toggle-source">Mermaidコードを表示</button>
        </div>
      </div>`;

    return `
      <div class="rpe-sequence-header">
        <span class="rpe-sequence-title">シーケンス図</span>
        ${menuMarkup}
      </div>
      <div class="rpe-sequence-layout">
        <div class="rpe-sequence-main">
          <pre class="rpe-sequence-source" hidden>${escapeHtml(source)}</pre>
          <div class="rpe-sequence-viewer">
            <div class="rpe-sequence-canvas"></div>
          </div>
        </div>
        <aside class="rpe-sequence-options" hidden>
          <div class="rpe-sequence-options-header">
            <h3 class="rpe-sequence-options-title">プレビューオプション</h3>
          </div>
          <section class="rpe-sequence-option-section">
            <h4>画面表示</h4>
            <div class="rpe-sequence-option-row rpe-sequence-zoom-row">
              <span class="rpe-sequence-field-label">ズーム</span>
              <div class="rpe-sequence-zoom-controls">
                <button type="button" class="rpe-sequence-zoom-button" data-action="zoom-out" title="10%縮小">−</button>
                <span class="rpe-sequence-zoom-label">100%</span>
                <button type="button" class="rpe-sequence-zoom-button" data-action="zoom-in" title="10%拡大">＋</button>
                <button type="button" class="rpe-sequence-zoom-button" data-action="zoom-reset">100%</button>
              </div>
            </div>
            <button type="button" class="rpe-sequence-reset-button" data-action="reset-view" title="ズームを100%に戻し、縦・横スクロールバーを消して表示位置を左上へ戻します">画面表示をリセット</button>
          </section>
          <section class="rpe-sequence-option-section">
            <h4>画像保存</h4>
            <div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">幅</span><input type="number" min="100" max="12000" step="1" data-role="export-width"><span>px</span></div>
            <div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">高さ</span><input type="number" min="100" max="20000" step="1" data-role="export-height"><span>px</span></div>
            <div class="rpe-sequence-check-row"><input type="checkbox" data-role="ratio-lock" checked><span>縦横比を固定</span></div>
            <div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">背景色</span><input type="color" value="#ffffff" data-role="export-background"><span data-role="export-background-text">#ffffff</span></div>
            <div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">JPEG品質</span><input type="number" min="10" max="100" step="1" value="90" data-role="jpeg-quality"><span>%</span></div>
            <button type="button" class="rpe-sequence-reset-button" data-action="reset-export" title="保存サイズを現在の画面表示サイズへ戻し、背景色・JPEG品質を初期値へ戻します">画像保存を初期化</button>
            <div class="rpe-sequence-save-buttons">
              <button type="button" class="rpe-sequence-save-button" data-action="export-png">PNGで保存</button>
              <button type="button" class="rpe-sequence-save-button" data-action="export-jpeg">JPEGで保存</button>
              <button type="button" class="rpe-sequence-save-button" data-action="export-svg">SVGで保存</button>
            </div>
          </section>
        </aside>
      </div>`;
  }

  function renderPre(pre, source) {
    diagramSerial += 1;
    const component = document.createElement('section');
    component.className = 'rpe-sequence-diagram';
    component.dataset.diagramId = String(diagramSerial);
    component.dataset.zoom = '1';
    component.innerHTML = componentMarkup(source, diagramSerial);

    try {
      const result = renderSequence(source);
      component.querySelector('.rpe-sequence-canvas').appendChild(result.svg);
      component.dataset.exportRatio = String(result.height / result.width);
    } catch (error) {
      component.querySelector('.rpe-sequence-canvas').innerHTML =
        `<div class="rpe-sequence-error">シーケンス図を表示できませんでした。\n${escapeHtml(error.message)}</div>`;
    }

    pre.replaceWith(component);
    wireComponent(component);
  }

  let initScheduled = false;

  function init() {
    initScheduled = false;
    if (!TARGET_PATH.test(location.pathname)) return;

    document.querySelectorAll('pre').forEach((pre) => {
      const source = sourceFromPre(pre);
      if (source) renderPre(pre, source);
    });
  }

  function scheduleInit() {
    if (initScheduled) return;
    initScheduled = true;
    requestAnimationFrame(init);
  }

  function startObserver() {
    if (!document.body || document.body.dataset.rpeSequenceObserver === '1') return;
    document.body.dataset.rpeSequenceObserver = '1';

    const observer = new MutationObserver((mutations) => {
      const hasAddedNodes = mutations.some((mutation) => mutation.addedNodes.length > 0);
      if (hasAddedNodes) scheduleInit();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    startObserver();
  });
  document.addEventListener('turbo:load', () => {
    init();
    startObserver();
  });
})();

/* === Project Explorer flowchart renderer (bundled for Redmine UI) === */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const TARGET_PATH = /\/issues\/(?:\d+(?:\/|$)|new(?:\/|$))|\/wiki(?:\/|$)|\/issues\/issue-\d+\.html(?:$|[?#])/;
  let diagramSerial = 0;

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function svgElement(name, attrs = {}, text = null) {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    });
    if (text !== null) el.textContent = String(text);
    return el;
  }

  function splitMarkupLines(text) {
    return String(text)
      .split(/<br\s*\/?\s*>|\\n/i)
      .map((line) => line.trim())
      .filter((line, index, arr) => line.length > 0 || arr.length === 1);
  }

  function estimateWidth(text, fontSize = 14) {
    let units = 0;
    for (const ch of String(text)) {
      units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.58;
    }
    return Math.max(30, units * fontSize);
  }

  function addMultilineText(parent, x, y, lines, options = {}) {
    const fontSize = options.fontSize || 14;
    const lineHeight = options.lineHeight || Math.round(fontSize * 1.35);
    const anchor = options.anchor || 'middle';
    const text = svgElement('text', {
      x,
      y,
      'text-anchor': anchor,
      'font-size': fontSize,
      'font-family': 'Arial, "Noto Sans JP", sans-serif',
      'font-weight': options.weight || '400',
      fill: options.fill || '#24292f'
    });
    lines.forEach((line, index) => {
      text.appendChild(svgElement('tspan', { x, dy: index === 0 ? 0 : lineHeight }, line));
    });
    parent.appendChild(text);
    return text;
  }

  function stripQuotes(value) {
    const text = String(value || '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    return text;
  }

  function parseNodeToken(token) {
    const raw = String(token || '').trim().replace(/;$/, '');
    const idMatch = raw.match(/^([A-Za-z0-9_.-]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    const rest = raw.slice(id.length).trim();
    if (!rest) return { id, label: id, shape: 'rect' };

    const forms = [
      [/^\(\((.*)\)\)$/, 'circle'],
      [/^\(\[(.*)\]\)$/, 'cylinder'],
      [/^\[\[(.*)\]\]$/, 'subroutine'],
      [/^\(\[(.*)\]\)$/, 'stadium'],
      [/^\{(.*)\}$/, 'diamond'],
      [/^\((.*)\)$/, 'round'],
      [/^\[(.*)\]$/, 'rect']
    ];

    for (const [pattern, shape] of forms) {
      const match = rest.match(pattern);
      if (match) return { id, label: stripQuotes(match[1]), shape };
    }
    return { id, label: stripQuotes(rest), shape: 'rect' };
  }

  function parseEdge(line) {
    const arrowPattern = '(?:==>|-.->|-->|---|--x|--o)';
    let match = line.match(new RegExp(`^(.+?)\\s*(${arrowPattern})\\s*\\|([^|]+)\\|\\s*(.+?)\\s*;?$`));
    if (match) return { left: match[1], arrow: match[2], label: match[3].trim(), right: match[4] };

    match = line.match(new RegExp(`^(.+?)\\s*--\\s*([^>-]+?)\\s*(${arrowPattern})\\s*(.+?)\\s*;?$`));
    if (match) return { left: match[1], arrow: match[3], label: match[2].trim(), right: match[4] };

    match = line.match(new RegExp(`^(.+?)\\s*(${arrowPattern})\\s*(.+?)\\s*;?$`));
    if (match) return { left: match[1], arrow: match[2], label: '', right: match[3] };
    return null;
  }

  function parseFlowchart(source) {
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    const first = lines.findIndex((line) => line.trim().length > 0);
    const header = first >= 0 ? lines[first].trim() : '';
    const headerMatch = header.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
    if (!headerMatch) throw new Error('flowchart TD/LR/RL/BT または graph TD/LR/RL/BT で始まるMermaidフローチャートではありません。');

    const direction = headerMatch[1].toUpperCase() === 'TB' ? 'TD' : headerMatch[1].toUpperCase();
    const nodes = new Map();
    const edges = [];

    function ensureNode(parsed) {
      if (!parsed) return null;
      const existing = nodes.get(parsed.id);
      if (!existing) nodes.set(parsed.id, { ...parsed });
      else if (parsed.label && parsed.label !== parsed.id) Object.assign(existing, parsed);
      return nodes.get(parsed.id);
    }

    for (let i = first + 1; i < lines.length; i += 1) {
      let line = lines[i].trim();
      if (!line || line.startsWith('%%')) continue;
      if (/^(classDef|class|style|linkStyle|click)\b/i.test(line)) continue;
      if (/^(subgraph|end)\b/i.test(line)) continue;

      const edge = parseEdge(line);
      if (edge) {
        const left = ensureNode(parseNodeToken(edge.left));
        const right = ensureNode(parseNodeToken(edge.right));
        if (left && right) edges.push({ from: left.id, to: right.id, arrow: edge.arrow, label: edge.label });
        continue;
      }

      const node = parseNodeToken(line);
      if (node) ensureNode(node);
    }

    if (!nodes.size) throw new Error('フローチャートのノードを確認できません。');
    return { direction, nodes: [...nodes.values()], edges };
  }

  function computeRanks(model) {
    const ids = model.nodes.map((node) => node.id);
    const incoming = new Map(ids.map((id) => [id, 0]));
    const outgoing = new Map(ids.map((id) => [id, []]));
    model.edges.forEach((edge) => {
      if (outgoing.has(edge.from) && incoming.has(edge.to)) {
        outgoing.get(edge.from).push(edge.to);
        incoming.set(edge.to, incoming.get(edge.to) + 1);
      }
    });

    const queue = ids.filter((id) => incoming.get(id) === 0);
    const rank = new Map(ids.map((id) => [id, 0]));
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      seen.add(id);
      outgoing.get(id).forEach((to) => {
        rank.set(to, Math.max(rank.get(to), rank.get(id) + 1));
        incoming.set(to, incoming.get(to) - 1);
        if (incoming.get(to) === 0) queue.push(to);
      });
    }

    // Cycles are valid in flowcharts. Put unresolved nodes after their strongest predecessor.
    ids.filter((id) => !seen.has(id)).forEach((id, index) => {
      const predecessors = model.edges.filter((edge) => edge.to === id).map((edge) => rank.get(edge.from) || 0);
      rank.set(id, Math.max(rank.get(id) || 0, predecessors.length ? Math.max(...predecessors) + 1 : index));
    });
    return rank;
  }

  function nodeMetrics(node) {
    const lines = splitMarkupLines(node.label);
    const textWidth = Math.max(...lines.map((line) => estimateWidth(line, 14)), 70);
    const width = Math.max(node.shape === 'circle' ? 76 : 120, Math.min(260, textWidth + 42));
    const height = Math.max(node.shape === 'diamond' ? 86 : 54, 26 + (lines.length * 19));
    return { ...node, lines, width, height };
  }

  function renderFlowchart(source) {
    const model = parseFlowchart(source);
    const rank = computeRanks(model);
    const metrics = new Map(model.nodes.map((node) => [node.id, nodeMetrics(node)]));
    const groups = new Map();
    model.nodes.forEach((node) => {
      const r = rank.get(node.id) || 0;
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(node.id);
    });

    const ranks = [...groups.keys()].sort((a, b) => a - b);
    if (model.direction === 'BT' || model.direction === 'RL') ranks.reverse();

    const vertical = model.direction === 'TD' || model.direction === 'BT';
    const rankGap = vertical ? 118 : 170;
    const nodeGap = vertical ? 58 : 52;
    const margin = 70;
    const positions = new Map();

    let maxCross = 0;
    ranks.forEach((r) => {
      const ids = groups.get(r) || [];
      const cross = ids.reduce((sum, id) => sum + (vertical ? metrics.get(id).width : metrics.get(id).height), 0) + Math.max(0, ids.length - 1) * nodeGap;
      maxCross = Math.max(maxCross, cross);
    });

    ranks.forEach((r, rankIndex) => {
      const ids = groups.get(r) || [];
      const total = ids.reduce((sum, id) => sum + (vertical ? metrics.get(id).width : metrics.get(id).height), 0) + Math.max(0, ids.length - 1) * nodeGap;
      let cursor = margin + (maxCross - total) / 2;
      ids.forEach((id) => {
        const m = metrics.get(id);
        if (vertical) {
          const x = cursor + m.width / 2;
          const y = margin + rankIndex * rankGap + m.height / 2;
          positions.set(id, { x, y });
          cursor += m.width + nodeGap;
        } else {
          const x = margin + rankIndex * rankGap + m.width / 2;
          const y = cursor + m.height / 2;
          positions.set(id, { x, y });
          cursor += m.height + nodeGap;
        }
      });
    });

    let width = 720;
    let height = 420;
    positions.forEach((pos, id) => {
      const m = metrics.get(id);
      width = Math.max(width, pos.x + m.width / 2 + margin);
      height = Math.max(height, pos.y + m.height / 2 + margin);
    });

    const svg = svgElement('svg', {
      xmlns: NS,
      viewBox: `0 0 ${Math.ceil(width)} ${Math.ceil(height)}`,
      role: 'img',
      'aria-label': 'フローチャート',
      'data-rpe-natural-width': Math.ceil(width),
      'data-rpe-natural-height': Math.ceil(height),
      preserveAspectRatio: 'xMidYMin meet'
    });

    const defs = svgElement('defs');
    const marker = svgElement('marker', {
      id: `rpe-flow-arrow-${diagramSerial}`,
      viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
    });
    marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#344054' }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    svg.appendChild(svgElement('rect', { x: 0, y: 0, width, height, fill: '#ffffff' }));

    const edgeLayer = svgElement('g', { class: 'rpe-flow-edges' });
    const nodeLayer = svgElement('g', { class: 'rpe-flow-nodes' });

    function boundaryPoint(from, to, m) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.abs(dx) > Math.abs(dy)) return { x: from.x + Math.sign(dx || 1) * m.width / 2, y: from.y };
      return { x: from.x, y: from.y + Math.sign(dy || 1) * m.height / 2 };
    }

    model.edges.forEach((edge) => {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) return;
      const ma = metrics.get(edge.from);
      const mb = metrics.get(edge.to);
      const start = boundaryPoint(a, b, ma);
      const end = boundaryPoint(b, a, mb);
      const dashed = edge.arrow === '-.->';
      const thick = edge.arrow === '==>';
      const hasArrow = edge.arrow !== '---';

      let d;
      if (vertical) {
        const midY = (start.y + end.y) / 2;
        d = `M ${start.x} ${start.y} V ${midY} H ${end.x} V ${end.y}`;
      } else {
        const midX = (start.x + end.x) / 2;
        d = `M ${start.x} ${start.y} H ${midX} V ${end.y} H ${end.x}`;
      }
      edgeLayer.appendChild(svgElement('path', {
        d,
        fill: 'none',
        stroke: '#344054',
        'stroke-width': thick ? 2.6 : 1.5,
        'stroke-dasharray': dashed ? '6 4' : null,
        'marker-end': hasArrow ? `url(#rpe-flow-arrow-${diagramSerial})` : null
      }));

      if (edge.label) {
        const x = (start.x + end.x) / 2;
        const y = (start.y + end.y) / 2 - 7;
        const labelWidth = Math.max(38, estimateWidth(edge.label, 12) + 14);
        edgeLayer.appendChild(svgElement('rect', { x: x - labelWidth / 2, y: y - 13, width: labelWidth, height: 20, rx: 3, fill: '#ffffff' }));
        addMultilineText(edgeLayer, x, y + 1, [edge.label], { fontSize: 12, weight: '600' });
      }
    });

    model.nodes.forEach((node) => {
      const pos = positions.get(node.id);
      const m = metrics.get(node.id);
      const g = svgElement('g', { class: 'rpe-flow-node', 'data-node-id': node.id });
      const x = pos.x - m.width / 2;
      const y = pos.y - m.height / 2;
      const common = { fill: '#f8fafc', stroke: '#667085', 'stroke-width': 1.4 };

      if (m.shape === 'diamond') {
        const points = `${pos.x},${y} ${x + m.width},${pos.y} ${pos.x},${y + m.height} ${x},${pos.y}`;
        g.appendChild(svgElement('polygon', { points, ...common }));
      } else if (m.shape === 'circle') {
        const r = Math.max(m.width, m.height) / 2;
        g.appendChild(svgElement('circle', { cx: pos.x, cy: pos.y, r, ...common }));
      } else if (m.shape === 'round' || m.shape === 'stadium') {
        g.appendChild(svgElement('rect', { x, y, width: m.width, height: m.height, rx: m.shape === 'stadium' ? m.height / 2 : 12, ...common }));
      } else if (m.shape === 'subroutine') {
        g.appendChild(svgElement('rect', { x, y, width: m.width, height: m.height, rx: 3, ...common }));
        g.appendChild(svgElement('line', { x1: x + 10, y1: y, x2: x + 10, y2: y + m.height, stroke: '#667085' }));
        g.appendChild(svgElement('line', { x1: x + m.width - 10, y1: y, x2: x + m.width - 10, y2: y + m.height, stroke: '#667085' }));
      } else if (m.shape === 'cylinder') {
        g.appendChild(svgElement('rect', { x, y: y + 7, width: m.width, height: m.height - 14, ...common }));
        g.appendChild(svgElement('ellipse', { cx: pos.x, cy: y + 7, rx: m.width / 2, ry: 7, ...common }));
        g.appendChild(svgElement('ellipse', { cx: pos.x, cy: y + m.height - 7, rx: m.width / 2, ry: 7, fill: 'none', stroke: '#667085', 'stroke-width': 1.4 }));
      } else {
        g.appendChild(svgElement('rect', { x, y, width: m.width, height: m.height, rx: 4, ...common }));
      }

      const totalTextHeight = (m.lines.length - 1) * 18;
      addMultilineText(g, pos.x, pos.y - totalTextHeight / 2 + 5, m.lines, { fontSize: 14, lineHeight: 18, weight: '600' });
      nodeLayer.appendChild(g);
    });

    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);
    return { svg, width: Math.ceil(width), height: Math.ceil(height) };
  }

  function sourceFromElement(element) {
    if (!element || element.closest('.rpe-sequence-diagram')) return null;

    let text = '';
    if (element.tagName === 'PRE') {
      const code = element.querySelector(':scope > code');
      text = (code ? code.textContent : element.textContent || '').trim();
    } else if (element.tagName === 'P') {
      // Redmine's issue/Wiki preview renders plain Mermaid text as
      // <p>line1<br>line2...</p>, not as <pre>. innerText preserves those
      // line breaks, so the same flowchart parser can consume it.
      text = (element.innerText || element.textContent || '').trim();
    }

    if (!/^(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/i.test(text)) return null;
    return text;
  }

  function currentSvg(component) { return component.querySelector('.rpe-sequence-canvas svg'); }

  function setSvgScale(component, scale) {
    const svg = currentSvg(component);
    if (!svg) return;
    const canvas = component.querySelector('.rpe-sequence-canvas');
    const label = component.querySelector('.rpe-sequence-zoom-label');
    component.dataset.zoom = String(scale);
    canvas.style.width = `${Math.round(scale * 100)}%`;
    svg.style.width = '100%';
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
  }

  function svgWithExportSize(svg, width, height, background) {
    const clone = svg.cloneNode(true);
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.setAttribute('viewBox', svg.getAttribute('viewBox'));
    clone.style.width = '';
    clone.style.height = '';
    const bg = clone.querySelector(':scope > rect');
    if (bg) bg.setAttribute('fill', background || '#ffffff');
    return clone;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSettings(component) {
    const widthInput = component.querySelector('[data-role="export-width"]');
    const heightInput = component.querySelector('[data-role="export-height"]');
    const backgroundInput = component.querySelector('[data-role="export-background"]');
    return {
      width: Math.max(100, Math.min(12000, Number(widthInput.value) || 1000)),
      height: Math.max(100, Math.min(20000, Number(heightInput.value) || 1000)),
      background: backgroundInput.value || '#ffffff'
    };
  }

  function exportSvg(component) {
    const svg = currentSvg(component); if (!svg) return;
    const { width, height, background } = exportSettings(component);
    const xml = new XMLSerializer().serializeToString(svgWithExportSize(svg, width, height, background));
    downloadBlob(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml;charset=utf-8' }), `flowchart-${component.dataset.diagramId}.svg`);
  }

  function exportRaster(component, mimeType) {
    const svg = currentSvg(component); if (!svg) return;
    const settings = exportSettings(component);
    const qualityInput = component.querySelector('[data-role="jpeg-quality"]');
    const quality = Math.max(0.1, Math.min(1, (Number(qualityInput.value) || 90) / 100));
    const xml = new XMLSerializer().serializeToString(svgWithExportSize(svg, settings.width, settings.height, settings.background));
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = settings.width; canvas.height = settings.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = settings.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((out) => {
          if (!out) return alert('画像の生成に失敗しました。解像度を小さくして再度お試しください。');
          const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
          downloadBlob(out, `flowchart-${component.dataset.diagramId}.${ext}`);
        }, mimeType, mimeType === 'image/jpeg' ? quality : undefined);
      } catch (error) {
        URL.revokeObjectURL(url);
        alert(`画像保存に失敗しました。\n${error.message}`);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(url); alert('SVGから画像への変換に失敗しました。'); };
    image.src = url;
  }

  function syncExportSize(component, force = false) {
    const svg = currentSvg(component); if (!svg) return;
    const widthInput = component.querySelector('[data-role="export-width"]');
    const heightInput = component.querySelector('[data-role="export-height"]');
    const viewer = component.querySelector('.rpe-sequence-viewer');
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const fallbackWidth = Math.max(100, Math.round(viewer.clientWidth - 24));
    const displayWidth = Math.max(100, Math.round(rect.width || fallbackWidth));
    const ratio = viewBox.width > 0 ? viewBox.height / viewBox.width : 1;
    const displayHeight = Math.max(100, Math.round(displayWidth * ratio));
    if (force || !component.dataset.exportSizeInitialized) {
      widthInput.value = displayWidth; heightInput.value = displayHeight;
      component.dataset.exportSizeInitialized = '1'; component.dataset.exportRatio = String(ratio);
    }
  }

  function wireComponent(component) {
    const menuButtons = [...component.querySelectorAll('[data-role="menu-button"]')];
    const menus = [...component.querySelectorAll('.rpe-sequence-menu')];
    const optionToggles = [...component.querySelectorAll('[data-action="toggle-options"]')];
    const sourceToggles = [...component.querySelectorAll('[data-action="toggle-source"]')];
    const options = component.querySelector('.rpe-sequence-options');
    const viewer = component.querySelector('.rpe-sequence-viewer');
    const widthInput = component.querySelector('[data-role="export-width"]');
    const heightInput = component.querySelector('[data-role="export-height"]');
    const ratioLock = component.querySelector('[data-role="ratio-lock"]');
    const sourceBox = component.querySelector('.rpe-sequence-source');
    const backgroundInput = component.querySelector('[data-role="export-background"]');
    const backgroundText = component.querySelector('[data-role="export-background-text"]');
    const qualityInput = component.querySelector('[data-role="jpeg-quality"]');

    function closeMenus(except = null) { menus.forEach((menu) => { if (menu !== except) menu.hidden = true; }); }
    function syncMenuLabels() {
      optionToggles.forEach((button) => { button.textContent = options.hidden ? 'プレビューオプションを表示' : 'プレビューオプションを隠す'; });
      sourceToggles.forEach((button) => { button.textContent = sourceBox.hidden ? 'Mermaidコードを表示' : 'Mermaidコードを隠す'; });
    }

    menuButtons.forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = button.closest('.rpe-sequence-menu-wrap')?.querySelector('.rpe-sequence-menu');
      if (!menu) return;
      const willOpen = menu.hidden; closeMenus(menu); menu.hidden = !willOpen;
    }));
    menus.forEach((menu) => menu.addEventListener('click', (event) => event.stopPropagation()));
    optionToggles.forEach((button) => button.addEventListener('click', () => {
      options.hidden = !options.hidden; component.classList.toggle('rpe-options-open', !options.hidden);
      syncMenuLabels(); closeMenus();
      if (!options.hidden) requestAnimationFrame(() => syncExportSize(component, false));
    }));
    sourceToggles.forEach((button) => button.addEventListener('click', () => { sourceBox.hidden = !sourceBox.hidden; syncMenuLabels(); closeMenus(); }));

    function applyZoom(scale, resetPosition = false) {
      const normalized = Math.max(0.5, Math.min(3, Math.round(scale * 10) / 10));
      setSvgScale(component, normalized);
      const zoomed = Math.abs(normalized - 1) > 0.001;
      viewer.classList.toggle('rpe-zoom-enabled', zoomed);
      viewer.classList.toggle('rpe-scroll-enabled', zoomed);
      if (!zoomed || resetPosition) { viewer.scrollTop = 0; viewer.scrollLeft = 0; }
    }
    component.querySelector('[data-action="zoom-out"]').addEventListener('click', () => applyZoom(Number(component.dataset.zoom || 1) - 0.1));
    component.querySelector('[data-action="zoom-in"]').addEventListener('click', () => applyZoom(Number(component.dataset.zoom || 1) + 0.1));
    component.querySelector('[data-action="zoom-reset"]').addEventListener('click', () => applyZoom(1, true));

    widthInput.addEventListener('input', () => { if (ratioLock.checked) { const ratio = Number(component.dataset.exportRatio || 1); const width = Number(widthInput.value); if (width > 0) heightInput.value = Math.max(1, Math.round(width * ratio)); } });
    heightInput.addEventListener('input', () => { if (ratioLock.checked) { const ratio = Number(component.dataset.exportRatio || 1); const height = Number(heightInput.value); if (height > 0 && ratio > 0) widthInput.value = Math.max(1, Math.round(height / ratio)); } });
    backgroundInput.addEventListener('input', () => { backgroundText.textContent = backgroundInput.value || '#ffffff'; });
    component.querySelector('[data-action="export-png"]').addEventListener('click', () => exportRaster(component, 'image/png'));
    component.querySelector('[data-action="export-jpeg"]').addEventListener('click', () => exportRaster(component, 'image/jpeg'));
    component.querySelector('[data-action="export-svg"]').addEventListener('click', () => exportSvg(component));
    component.querySelector('[data-action="reset-export"]').addEventListener('click', () => { ratioLock.checked = true; backgroundInput.value = '#ffffff'; backgroundText.textContent = '#ffffff'; qualityInput.value = '90'; syncExportSize(component, true); });
    component.querySelector('[data-action="reset-view"]').addEventListener('click', () => applyZoom(1, true));
    document.addEventListener('click', (event) => { if (!component.contains(event.target)) closeMenus(); });
    syncMenuLabels(); requestAnimationFrame(() => syncExportSize(component, true));
  }

  function componentMarkup(source) {
    const menuMarkup = `<div class="rpe-sequence-menu-wrap"><button type="button" class="rpe-sequence-menu-button" data-role="menu-button" aria-haspopup="true">その他 ▾</button><div class="rpe-sequence-menu" hidden><button type="button" class="rpe-sequence-menu-item" data-action="toggle-options">プレビューオプションを表示</button><button type="button" class="rpe-sequence-menu-item" data-action="toggle-source">Mermaidコードを表示</button></div></div>`;
    return `
      <div class="rpe-sequence-header"><span class="rpe-sequence-title">フローチャート</span>${menuMarkup}</div>
      <div class="rpe-sequence-layout">
        <div class="rpe-sequence-main">
          <pre class="rpe-sequence-source" hidden>${escapeHtml(source)}</pre>
          <div class="rpe-sequence-viewer"><div class="rpe-sequence-canvas"></div></div>
        </div>
        <aside class="rpe-sequence-options" hidden>
          <div class="rpe-sequence-options-header"><h3 class="rpe-sequence-options-title">プレビューオプション</h3></div>
          <section class="rpe-sequence-option-section"><h4>画面表示</h4><div class="rpe-sequence-option-row rpe-sequence-zoom-row"><span class="rpe-sequence-field-label">ズーム</span><div class="rpe-sequence-zoom-controls"><button type="button" class="rpe-sequence-zoom-button" data-action="zoom-out" title="10%縮小">−</button><span class="rpe-sequence-zoom-label">100%</span><button type="button" class="rpe-sequence-zoom-button" data-action="zoom-in" title="10%拡大">＋</button><button type="button" class="rpe-sequence-zoom-button" data-action="zoom-reset">100%</button></div></div><button type="button" class="rpe-sequence-reset-button" data-action="reset-view">画面表示をリセット</button></section>
          <section class="rpe-sequence-option-section"><h4>画像保存</h4><div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">幅</span><input type="number" min="100" max="12000" step="1" data-role="export-width"><span>px</span></div><div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">高さ</span><input type="number" min="100" max="20000" step="1" data-role="export-height"><span>px</span></div><div class="rpe-sequence-check-row"><input type="checkbox" data-role="ratio-lock" checked><span>縦横比を固定</span></div><div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">背景色</span><input type="color" value="#ffffff" data-role="export-background"><span data-role="export-background-text">#ffffff</span></div><div class="rpe-sequence-option-row"><span class="rpe-sequence-field-label">JPEG品質</span><input type="number" min="10" max="100" step="1" value="90" data-role="jpeg-quality"><span>%</span></div><button type="button" class="rpe-sequence-reset-button" data-action="reset-export">画像保存を初期化</button><div class="rpe-sequence-save-buttons"><button type="button" class="rpe-sequence-save-button" data-action="export-png">PNGで保存</button><button type="button" class="rpe-sequence-save-button" data-action="export-jpeg">JPEGで保存</button><button type="button" class="rpe-sequence-save-button" data-action="export-svg">SVGで保存</button></div></section>
        </aside>
      </div>`;
  }

  function renderPre(pre, source) {
    diagramSerial += 1;
    const component = document.createElement('section');
    component.className = 'rpe-sequence-diagram rpe-flowchart-diagram';
    component.dataset.diagramId = String(diagramSerial);
    component.dataset.zoom = '1';
    component.innerHTML = componentMarkup(source);
    try {
      const result = renderFlowchart(source);
      component.querySelector('.rpe-sequence-canvas').appendChild(result.svg);
      component.dataset.exportRatio = String(result.height / result.width);
    } catch (error) {
      component.querySelector('.rpe-sequence-canvas').innerHTML = `<div class="rpe-sequence-error">フローチャートを表示できませんでした。\n${escapeHtml(error.message)}</div>`;
    }
    pre.replaceWith(component);
    wireComponent(component);
  }

  let initScheduled = false;
  function init() {
    initScheduled = false;
    if (!TARGET_PATH.test(location.pathname)) return;

    // Saved issue/Wiki content may use <pre>, while Redmine's live preview
    // uses <p> with <br> separators. Support both DOM forms.
    document.querySelectorAll('pre, .wiki-preview p, .wiki p').forEach((element) => {
      const source = sourceFromElement(element);
      if (source) renderPre(element, source);
    });
  }
  function scheduleInit() { if (!initScheduled) { initScheduled = true; requestAnimationFrame(init); } }
  function startObserver() {
    if (!document.body || document.body.dataset.rpeFlowObserver === '1') return;
    document.body.dataset.rpeFlowObserver = '1';
    const observer = new MutationObserver((mutations) => { if (mutations.some((mutation) => mutation.addedNodes.length > 0)) scheduleInit(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', () => { init(); startObserver(); });
  document.addEventListener('turbo:load', () => { init(); startObserver(); });
})();

