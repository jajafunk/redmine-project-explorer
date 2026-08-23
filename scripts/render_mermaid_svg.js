'use strict';

const fs = require('fs');
const puppeteer =
  require('/opt/rpe-mermaid/node_modules/puppeteer-core');

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', chunk => {
      data += chunk;
    });

    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const source = await readStdin();

  if (!source.trim()) {
    throw new Error('Mermaid source is empty');
  }

  const mermaidPath =
    process.env.RPE_MERMAID_JS ||
    '/usr/src/redmine/plugins/redmine_project_explorer/assets/javascripts/vendor/mermaid.min.js';

  const chromiumPath =
    process.env.RPE_CHROMIUM ||
    '/usr/bin/chromium';

  if (!fs.existsSync(mermaidPath)) {
    throw new Error(
      `Mermaid library not found: ${mermaidPath}`
    );
  }

  const browser =
    await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

  try {
    const page = await browser.newPage();

    await page.setContent(
      '<!doctype html><html><head><meta charset="UTF-8"></head><body></body></html>'
    );

    await page.addScriptTag({
      path: mermaidPath
    });

    const svg =
      await page.evaluate(async (mermaidSource) => {

        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default',
          htmlLabels: true,

          themeVariables: {
            fontFamily:
              'Arial, "Noto Sans JP", "Yu Gothic", sans-serif',
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

        const id =
          `rpe-pdf-${Date.now()}`;

        const result =
          await window.mermaid.render(
            id,
            mermaidSource
          );

        const holder =
          document.createElement('div');

        holder.innerHTML = result.svg;

        document.body.appendChild(holder);

        const originalSvg =
          holder.querySelector('svg');

        if (!originalSvg) {
          throw new Error(
            'Mermaid did not generate SVG'
          );
        }

        /*
         * PDF/PNG用正規化。
         *
         * Mermaid htmlLabels:true の foreignObject を
         * SVG標準 text/tspan へ変換する。
         *
         * 画面側 mermaid_runtime.js の保存処理と
         * 同じ方式。
         */
        const clone =
          originalSvg.cloneNode(true);

        clone.setAttribute(
          'xmlns',
          'http://www.w3.org/2000/svg'
        );

        const originals =
          Array.from(
            originalSvg.querySelectorAll(
              'foreignObject'
            )
          );

        const copies =
          Array.from(
            clone.querySelectorAll(
              'foreignObject'
            )
          );

        copies.forEach(
          (foreignObject, index) => {

            const original =
              originals[index];

            if (!original) return;

            const labelSource =
              original.querySelector(
                '.nodeLabel, .edgeLabel, .label'
              ) || original;

            const labelClone =
              labelSource.cloneNode(true);

            labelClone
              .querySelectorAll('br')
              .forEach(br => {
                br.replaceWith(
                  document.createTextNode('\n')
                );
              });

            const rawText =
              (
                labelClone.textContent || ''
              )
                .replace(/\u00a0/g, ' ')
                .replace(/\r/g, '')
                .trim();

            const lines =
              rawText
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean);

            if (!lines.length) {
              foreignObject.remove();
              return;
            }

            const x =
              Number(
                foreignObject.getAttribute('x')
              ) || 0;

            const y =
              Number(
                foreignObject.getAttribute('y')
              ) || 0;

            const w =
              Number(
                foreignObject.getAttribute('width')
              ) || 0;

            const h =
              Number(
                foreignObject.getAttribute('height')
              ) || 0;

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

            lines.forEach(
              (line, lineIndex) => {

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
                      -(
                        (
                          lines.length - 1
                        ) *
                        lineHeight
                      ) / 2
                    )
                  );
                }
                else {
                  tspan.setAttribute(
                    'dy',
                    String(lineHeight)
                  );
                }

                tspan.textContent = line;

                text.appendChild(tspan);
              }
            );

            foreignObject.replaceWith(text);
          }
        );

        return (
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          new XMLSerializer()
            .serializeToString(clone)
        );
      }, source);

    process.stdout.write(svg);
  }
  finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(
    error && error.stack
      ? error.stack
      : String(error)
  );

  process.exit(1);
});
