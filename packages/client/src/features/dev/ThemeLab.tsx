import { useEffect, useState, type ReactNode } from "react";
import {
  Bookmark,
  Check,
  Crosshair,
  GitBranch,
  ListTodo,
  Play,
  Plus,
  ScrollText,
  Search,
  Send,
  Settings2,
  Swords,
  Trash,
  X,
} from "lucide-react";
import { UNIT_TYPES } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { BrandMark } from "../../components/BrandMark.tsx";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { Modal } from "../../components/Modal.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { Popover } from "../../components/Popover.tsx";
import { structureIcon } from "../../components/StructureIcon.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { UnitSymbol } from "../../components/UnitSymbol.tsx";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { polityFillColor, territoryColor } from "../../theme/palette.ts";
import styles from "./ThemeLab.module.css";

/** Token families, as theme authors meet them in a preset JSON. */
const TOKEN_GROUPS: Array<{ title: string; tokens: string[] }> = [
  { title: "Surfaces", tokens: ["surface-0", "surface-1", "surface-2", "surface-3"] },
  { title: "Text", tokens: ["text-primary", "text-secondary", "text-muted", "text-inverse"] },
  { title: "Accent", tokens: ["accent-base", "accent-hover", "accent-subtle", "accent-wash", "accent-line", "accent-deep"] },
  {
    title: "Semantic",
    tokens: ["semantic-success", "semantic-warning", "semantic-danger", "semantic-info"],
  },
  { title: "Borders", tokens: ["border-subtle", "border-strong", "border-focus"] },
  {
    title: "Loom",
    tokens: ["loom-canonical-edge", "loom-sibling-edge", "loom-node-current", "loom-node-pending"],
  },
];

const TYPE_SCALE = ["xl", "lg", "md", "sm", "xs"] as const;

const SAMPLE_REALMS = [
  { code: "FRA", name: "Kingdom of France", flag: "🇫🇷" },
  { code: "DEU", name: "Holy Roman Empire", flag: "" },
  { code: "GBR", name: "Kingdom of England", flag: "🇬🇧" },
  { code: "ESP", name: "Crown of Castile", flag: "" },
  { code: "ITA", name: "Papal States", flag: "" },
  { code: "TUR", name: "Sultanate of Rum", flag: "" },
];

const STRUCTURES = ["fortress", "port", "embassy", "factory", "mine", "abbey", "airbase", "radar", "silo", "camp"];

/**
 * /dev/themes — the design system on one page, for theme authors: switch
 * theme live and see every token, material, control and game mark re-dress.
 */
export function ThemeLab() {
  const themes = useThemesStore((state) => state.themes);
  const themeId = useUiStore((state) => state.themeId);
  const setThemeId = useUiStore((state) => state.setThemeId);
  const theme = selectTheme(themes, themeId);
  const [tab, setTab] = useState("advisor");
  const [modalOpen, setModalOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState(1);
  const values = useResolvedTokens(themeId);

  return (
    <div className={styles.lab}>
      <header className={styles.hero}>
        <div className={styles.heroTitle}>
          <BrandMark size={40} />
          <div>
            <span className="pfKicker">Pax Futura · design system</span>
            <h1 className={`${styles.title} pfTitle`}>Theme lab</h1>
          </div>
        </div>
        <p className={styles.lede}>
          Every surface consumes only <code>--pf-*</code> tokens and a handful of hook classes, so a
          theme is one JSON file. Switch themes to watch each primitive re-dress itself.
        </p>
        <div className={styles.switcher} role="radiogroup" aria-label="Theme">
          {themes.map((entry) => {
            const active = entry.meta.id === themeId;
            return (
              <button
                key={entry.meta.id}
                role="radio"
                aria-checked={active}
                className={`${styles.themeChip} ${active ? styles.themeChipActive : ""}`}
                onClick={() => setThemeId(entry.meta.id)}
              >
                <span className={styles.themeDots} aria-hidden>
                  {[entry.color.surface[0], entry.color.surface[2], entry.color.accent.base, entry.map.land].map(
                    (color, index) => (
                      <span key={index} style={{ background: color }} />
                    ),
                  )}
                </span>
                <span
                  className={styles.themeChipName}
                  style={{ fontFamily: entry.font.display, fontSizeAdjust: entry.font.displayAdjust ?? undefined }}
                >
                  {entry.meta.name}
                </span>
                {active ? <Check size={13} /> : null}
              </button>
            );
          })}
        </div>
        <div className={styles.meta}>
          <Badge>{theme.meta.scheme}</Badge>
          <Badge>corners · {theme.style.corners}</Badge>
          <Badge>ornament · {theme.style.ornament}</Badge>
          <Badge>texture · {theme.style.texture}</Badge>
          <Badge>glow · {theme.style.glow}</Badge>
          {theme.meta.tagline ? <span className={styles.tagline}>{theme.meta.tagline}</span> : null}
        </div>
      </header>

      <Plate kicker="01" title="Typography" note="Display carries names, dates and headlines; UI carries prose; mono carries data.">
        <div className={styles.typeGrid}>
          <div className={styles.typeSpecimen}>
            <span className="pfKicker">pfKicker · micro-label</span>
            <h2 className={`${styles.display} pfTitle`}>The Treaty of Venice</h2>
            <div className="pfRule">
              <span className="pfFleuron" />
            </div>
            <p className={styles.prose}>
              Envoys of the Most Serene Republic arrived bearing silk and a proposal: that the Order&rsquo;s
              ciphered ledgers be kept beneath the Rialto, guarded jointly, in exchange for preferential
              rates on Crusader notes. <em>Long prose sits at 1.6 line-height and about 68 characters.</em>
            </p>
            <p className={styles.mono}>
              <span className="pfGlowText">pfGlowText</span> · 1204-05-31 · 41,250 troops · Δ +3 relation
            </p>
          </div>
          <div className={styles.scale}>
            {TYPE_SCALE.map((size) => (
              <div key={size} className={styles.scaleRow}>
                <code className={styles.token}>--pf-font-{size}</code>
                <span className={styles.scaleSample} style={{ fontSize: `var(--pf-font-${size})` }}>
                  Order of the Seraph
                </span>
              </div>
            ))}
            <div className={styles.scaleRow}>
              <code className={styles.token}>--pf-font-display</code>
              <span className={styles.faceDisplay}>Aa Bb 1228</span>
            </div>
            <div className={styles.scaleRow}>
              <code className={styles.token}>--pf-font-ui</code>
              <span className={styles.faceUi}>Aa Bb 1228</span>
            </div>
            <div className={styles.scaleRow}>
              <code className={styles.token}>--pf-font-mono</code>
              <span className={styles.faceMono}>Aa Bb 1228</span>
            </div>
          </div>
        </div>
      </Plate>

      <Plate kicker="02" title="Colour tokens" note="Raw colours live only in the theme; components read these.">
        <div className={styles.tokenGroups}>
          {TOKEN_GROUPS.map((group) => (
            <div key={group.title} className={styles.tokenGroup}>
              <span className="pfKicker">{group.title}</span>
              <div className={styles.swatches}>
                {group.tokens.map((token) => (
                  <div key={token} className={styles.swatch}>
                    <span className={styles.chip} style={{ background: `var(--pf-${token})` }} />
                    <code className={styles.token}>{token}</code>
                    <span className={styles.value}>{values[token] ?? ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Plate>

      <Plate kicker="03" title="Material" note="pfPanel is the floating material — glass, paper or machined metal, with the theme's ornament.">
        <div className={styles.materialStage}>
          <div className={styles.mapBackdrop} aria-hidden>
            {SAMPLE_REALMS.slice(0, 4).map((realm) => (
              <span
                key={realm.code}
                className={styles.realm}
                style={{ background: territoryColor(theme, polityFillColor(theme, realm.code)) }}
              />
            ))}
          </div>
          <div className={`${styles.demoPanel} pfPanel`}>
            <div className={styles.demoHead}>
              <span className="pfKicker">Dossier · Turn 34</span>
              <h3 className={`${styles.demoTitle} pfTitle`}>Kingdom of France</h3>
            </div>
            <div className={styles.rows}>
              {["Mobilize the Norman levies", "Open talks with Venice", "Fortify the Loire crossings"].map(
                (label, index) => (
                  <button
                    key={label}
                    className={`${styles.row} ${selectedRow === index ? styles.rowSelected : ""}`}
                    onClick={() => setSelectedRow(index)}
                  >
                    <span className={styles.rowIndex}>{String(index + 1).padStart(2, "0")}</span>
                    {label}
                  </button>
                ),
              )}
            </div>
            <div className={styles.rails}>
              {(["minor", "major", "pivotal"] as const).map((importance) => (
                <div key={importance} className={`${styles.rail} ${styles[importance]}`}>
                  <span className="pfKicker">{importance}</span>
                  <span className={styles.railTitle}>
                    {importance === "pivotal"
                      ? "The Byzantine succession breaks"
                      : importance === "major"
                        ? "Venice opens a cipher-house"
                        : "Harvest fair at Troyes"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.materialNotes}>
            <Note name="pfPanel">Floating material + ornament. Host must be positioned.</Note>
            <Note name="--pf-panel-inset">Recessed cards and fields inside panels.</Note>
            <Note name="--pf-accent-wash">Hover and selected tints; selected adds accent-line + glow.</Note>
            <Note name="Importance rails">3px left bar: minor, major (warning), pivotal (danger + glow).</Note>
          </div>
        </div>
      </Plate>

      <Plate kicker="04" title="Controls" note="Shared components — use these, never fork them.">
        <div className={styles.controls}>
          <Cell title="Button" note="default · primary · danger · ghost; sm · md · lg; icon">
            <div className={styles.row2}>
              <Button>Default</Button>
              <Button variant="primary">
                <Play size={14} /> Advance
              </Button>
              <Button variant="danger">
                <Trash size={14} /> Delete branch
              </Button>
              <Button variant="ghost">Ghost</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className={styles.row2}>
              <Button size="sm">Small</Button>
              <Button size="lg" variant="primary">
                <Send size={16} /> Large
              </Button>
              <Button icon title="Search" aria-label="Search">
                <Search size={16} />
              </Button>
              <Button icon variant="ghost" title="Bookmark" aria-label="Bookmark">
                <Bookmark size={16} />
              </Button>
              <Button icon size="sm" variant="ghost" title="Close" aria-label="Close">
                <X size={14} />
              </Button>
            </div>
          </Cell>
          <Cell title="Badge" note="default · accent · success · warning · danger · info">
            <div className={styles.row2}>
              <Badge>3 turns</Badge>
              <Badge tone="accent">canonical</Badge>
              <Badge tone="success">live</Badge>
              <Badge tone="warning">exploratory</Badge>
              <Badge tone="danger">failed</Badge>
              <Badge tone="info">rumored</Badge>
            </div>
          </Cell>
          <Cell title="Tabs">
            <Tabs
              items={[
                { id: "advisor", label: "Advisor" },
                { id: "venice", label: "Venice" },
                { id: "council", label: "Council" },
              ]}
              activeId={tab}
              onSelect={setTab}
            />
          </Cell>
          <Cell title="Field" note="Field · TextAreaField · native select (themed globally)">
            <div className={styles.fields}>
              <Field label="Nation" defaultValue="Kingdom of France" />
              <label className={styles.selectField}>
                <span className={styles.selectLabel}>Difficulty</span>
                <select defaultValue="standard">
                  <option value="sandbox">Sandbox</option>
                  <option value="standard">Standard</option>
                  <option value="simulationist">Simulationist</option>
                </select>
              </label>
            </div>
            <TextAreaField label="Orders" defaultValue="Mobilize two divisions toward the Rhine…" rows={2} />
          </Cell>
          <Cell title="Overlays" note="Modal (portaled; title · kicker · size · footer) and Popover">
            <div className={styles.row2}>
              <Button onClick={() => setModalOpen(true)}>Open modal</Button>
              <Popover
                open={popoverOpen}
                onClose={() => setPopoverOpen(false)}
                align="start"
                width={240}
                trigger={
                  <Button variant="ghost" onClick={() => setPopoverOpen(!popoverOpen)}>
                    <Settings2 size={14} /> Popover
                  </Button>
                }
              >
                <div className={styles.popoverBody}>
                  <span className="pfKicker">Map projection</span>
                  <p>Popovers use the solid panel fill so they stay readable over glass.</p>
                </div>
              </Popover>
            </div>
          </Cell>
          <Cell title="Icons" note="lucide-react · 13–16 in rows, 18 in toolbars">
            <div className={`${styles.row2} ${styles.icons}`}>
              {[ListTodo, Crosshair, Swords, ScrollText, Search, GitBranch, Bookmark, Plus].map((Icon, index) => (
                <span key={index} className={styles.iconTile}>
                  <Icon size={18} />
                </span>
              ))}
            </div>
          </Cell>
        </div>
      </Plate>

      <Plate kicker="05" title="Game marks" note="Polity colours come from the theme's palette envelope; flags are content.">
        <div className={styles.marks}>
          <Cell title="PolityFlag" note="emoji · uploaded image · heraldic shield in the polity colour">
            <div className={styles.realms}>
              {SAMPLE_REALMS.map((realm) => (
                <span key={realm.code} className={styles.realmRow}>
                  <PolityFlag flag={realm.flag} color={polityFillColor(theme, realm.code)} size={22} />
                  <span className={styles.realmName}>{realm.name}</span>
                  <code className={styles.token}>{realm.code}</code>
                </span>
              ))}
            </div>
          </Cell>
          <Cell title="UnitSymbol" note="NATO-flavoured counters, tinted by owner">
            <div className={styles.units}>
              {UNIT_TYPES.map((type, index) => (
                <span key={type} className={styles.unit}>
                  <UnitSymbol type={type} color={polityFillColor(theme, SAMPLE_REALMS[index % 4]!.code)} size={36} />
                  <span className={styles.unitLabel}>{type}</span>
                </span>
              ))}
            </div>
          </Cell>
          <Cell title="structureIcon(kind)" note="free-form kinds resolve to a lucide mark">
            <div className={styles.units}>
              {STRUCTURES.map((kind) => {
                const Icon = structureIcon(kind);
                return (
                  <span key={kind} className={styles.unit}>
                    <span className={styles.structure}>
                      <Icon size={16} />
                    </span>
                    <span className={styles.unitLabel}>{kind}</span>
                  </span>
                );
              })}
            </div>
          </Cell>
        </div>
      </Plate>

      {modalOpen ? (
        <Modal
          kicker="Loom"
          title="Delete branch?"
          size="sm"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => setModalOpen(false)}>
                <Trash size={14} /> Delete
              </Button>
            </>
          }
        >
          <p className={styles.modalText}>
            This removes 4 turns and their conversations. Anchored turns in this branch lose their
            bookmarks.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function Plate({
  kicker,
  title,
  note,
  children,
}: {
  kicker: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.plate}>
      <header className={styles.plateHead}>
        <span className={styles.plateNumber}>{kicker}</span>
        <h2 className={`${styles.plateTitle} pfTitle`}>{title}</h2>
        {note ? <p className={styles.plateNote}>{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Cell({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.cell}>
      <div className={styles.cellHead}>
        <code className={styles.cellTitle}>{title}</code>
        {note ? <span className={styles.cellNote}>{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Note({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.note}>
      <code className={styles.token}>{name}</code>
      <span>{children}</span>
    </div>
  );
}

/** Resolved token values, re-read after each theme switch has been applied. */
function useResolvedTokens(themeId: string): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    // applyTheme runs in an effect too — read on the next frame, after it.
    const frame = requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const group of TOKEN_GROUPS) {
        for (const token of group.tokens) next[token] = style.getPropertyValue(`--pf-${token}`).trim();
      }
      setValues(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [themeId]);
  return values;
}
