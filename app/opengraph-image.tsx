import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { median, money, type MapData } from "@/lib/bins";
import { RAMP, rampColor, scalePosition } from "@/lib/color";
import { pooledQuantiles } from "@/lib/db";

/**
 * The link preview.
 *
 * Without this the page shipped og:title and og:description but no og:image,
 * so anywhere the link was posted fell back to a blank card. A map is the whole
 * point of the page, so the card draws the actual map from the same snapshot and
 * the same colour ramp the page uses -- a preview that promised something other
 * than what you land on would be worse than none.
 *
 * Satori cannot lay out arbitrary SVG path data, but it will rasterise an <img>
 * whose src is an SVG data URI, so the map is built as its own small SVG
 * document and handed over that way.
 */
export const alt = "Retail gasoline price by US county";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f1ece1";
const INK = "#1a1a1a";
const INK_SOFT = "#4a4a47";
const INK_MUTE = "#8a8a85";
const RULE = "#d6cfbe";

// Width of the map inside the card. 1200 wide less 112 of padding and a 404
// text column leaves 684; at the map's 975x610 that is 428 tall, inside the
// 530 of vertical room the padding leaves.
const MAP_W = 660;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p));

export default async function OpengraphImage() {
  const data = JSON.parse(read("data/counties.json").toString("utf8")) as MapData;
  const priced = data.counties.filter((c) => c.p !== null);
  const snapshot = priced.map((c) => c.p as number).sort((a, b) => a - b);

  // Same domain the page ranks against, so the colours in the preview are the
  // colours you land on. Falls back to the snapshot if the database is away at
  // build time -- a preview must never be the thing that fails a deploy.
  let domain = snapshot;
  try {
    const pooled = await pooledQuantiles();
    if (pooled.length > 1) domain = pooled;
  } catch {
    /* snapshot domain it is */
  }

  const fills = data.counties
    .map((c) =>
      c.p === null
        ? `<path d="${c.d}" fill="#e4ddcc"/>`
        : `<path d="${c.d}" fill="${rampColor(scalePosition(c.p, domain), RAMP)}"/>`,
    )
    .join("");
  const outlines = data.states.map((d) => `<path d="${d}"/>`).join("");
  const mapSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.w} ${data.h}" width="${data.w}" height="${data.h}">` +
    `${fills}<g fill="none" stroke="#00000022" stroke-width="0.5">${outlines}</g></svg>`;
  const mapUri = `data:image/svg+xml;base64,${Buffer.from(mapSvg).toString("base64")}`;

  const aaaBasis = priced.filter((c) => c.t === "aaa" || c.t === "dc");
  const values = aaaBasis.map((c) => c.p as number);
  const stats: [string, string][] = [
    [priced.length.toLocaleString(), "counties"],
    [money(median(values)), "median"],
    [money(Math.min(...values)), "lowest"],
    [money(Math.max(...values)), "highest"],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          padding: "50px 56px",
          fontFamily: "Newsreader",
        }}
      >
        {/* Text left, map right. Satori does not clip overflow the way a browser
            does, so the map is given an explicit box that fits rather than being
            left to size itself and run over everything. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 404,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", fontSize: 47, color: INK, lineHeight: 1.08, letterSpacing: -1 }}>
            What a gallon costs, county by county
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", width: 404 }}>
            {stats.map(([n, label]) => (
              <div
                key={label}
                style={{ display: "flex", flexDirection: "column", width: 202, marginBottom: 18 }}
              >
                <div style={{ display: "flex", fontSize: 33, color: INK }}>{n}</div>
                <div
                  style={{
                    display: "flex",
                    fontFamily: "JetBrains Mono",
                    fontSize: 13,
                    letterSpacing: 1.4,
                    color: INK_MUTE,
                    marginTop: 3,
                  }}
                >
                  {label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderTop: `1px solid ${RULE}`,
              paddingTop: 13,
              fontFamily: "JetBrains Mono",
              fontSize: 13,
              letterSpacing: 1,
              color: INK_SOFT,
            }}
          >
            <div style={{ display: "flex" }}>PUMP PRICE ATLAS</div>
            <div style={{ display: "flex", color: INK_MUTE, marginTop: 5 }}>
              aaa daily &middot; as of {data.fetched ?? "—"}
            </div>
          </div>
        </div>

        <div
          style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end" }}
        >
          <img src={mapUri} width={MAP_W} height={Math.round((MAP_W * data.h) / data.w)} />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Newsreader", data: read("app/fonts/news-400.ttf"), weight: 400, style: "normal" },
        { name: "Newsreader", data: read("app/fonts/news-600.ttf"), weight: 600, style: "normal" },
        { name: "JetBrains Mono", data: read("app/fonts/mono-400.ttf"), weight: 400, style: "normal" },
      ],
    },
  );
}
