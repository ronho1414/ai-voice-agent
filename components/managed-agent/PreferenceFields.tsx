"use client";

import { Fragment } from "react";
import { visiblePreferenceKeys } from "@/lib/platform/agent-preferences";
import {
  GREETING_MAX,
  NOTES_MAX,
  NOTES_NOTICE,
  NOTES_PLACEHOLDER,
  charCount,
  preferenceLabels,
  preferenceOptions,
  preferenceValueLabel,
  styleExamplesImport,
  type Preferences,
} from "./preference-ui";

type PreferenceFieldsProps = {
  value: Preferences;
  onChange: (next: Preferences) => void;
  disabled?: boolean;
  showNotes?: boolean;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  current?: Preferences | null;
  highlightKeys?: (keyof Preferences)[];
  idPrefix?: string;
};

export function PreferenceFields({
  value,
  onChange,
  disabled = false,
  showNotes = false,
  notes = "",
  onNotesChange,
  current = null,
  highlightKeys = [],
  idPrefix = "pref",
}: PreferenceFieldsProps) {
  const highlighted = new Set(highlightKeys);

  function setField<K extends keyof Preferences>(key: K, next: Preferences[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-5">
      {visiblePreferenceKeys.filter(key => key !== "greeting").map((key) => {
        const options = preferenceOptions[key];
        const selected = value[key];
        const isChanged = highlighted.has(key);
        return (
          <Fragment key={key}>
          {key === "voice_gender" && <h3 className="text-sm font-extrabold">聲線偏好</h3>}
          {key === "response_style" && <h3 className="text-sm font-extrabold">服務偏好</h3>}
          <fieldset
            disabled={disabled}
            className={`rounded-2xl border p-4 ${isChanged ? "border-emerald-300 bg-emerald-50" : "border-[#E4E4E7] bg-white"}`}
          >
            <legend className="px-1 text-xs font-extrabold text-[#09090B]">{preferenceLabels[key]}</legend>
            {current && (
              <p className="mb-3 text-[11px] text-[#71717A]">
                現況：{preferenceValueLabel(key, current[key])}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(options) as (keyof typeof options)[]).map((optionKey) => {
                const inputId = `${idPrefix}-${key}-${String(optionKey)}`;
                return (
                  <label
                    key={String(optionKey)}
                    htmlFor={inputId}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-xs transition-colors ${
                      selected === optionKey
                        ? isChanged ? "border-emerald-500 bg-emerald-100 text-emerald-900" : "border-[#09090B] bg-[#09090B] text-white"
                        : "border-[#E4E4E7] bg-white text-[#3F3F46] hover:border-[#A1A1AA]"
                    }`}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name={`${idPrefix}-${key}`}
                      className="mt-0.5"
                      checked={selected === optionKey}
                      onChange={() => setField(key, optionKey as Preferences[typeof key])}
                      disabled={disabled}
                    />
                    <span className="font-semibold leading-relaxed">{options[optionKey]}</span>
                  </label>
                );
              })}
            </div>
            {key === "response_style" &&
              selected !== null &&
              Object.prototype.hasOwnProperty.call(styleExamplesImport, selected) && (
              <p className="mt-3 rounded-xl bg-[#FAFAFA] px-3 py-2 text-[11px] leading-relaxed text-[#52525B]">
                示例：{styleExamplesImport[selected as keyof typeof styleExamplesImport]}
              </p>
            )}
          </fieldset>
          </Fragment>
        );
      })}

      <div className={`rounded-2xl border p-4 ${highlighted.has("greeting") ? "border-emerald-300 bg-emerald-50" : "border-[#E4E4E7] bg-white"}`}>
        <label htmlFor={`${idPrefix}-greeting`} className="block text-xs font-extrabold text-[#09090B]">
          {preferenceLabels.greeting}
        </label>
        {current && (
          <p className="mt-2 text-[11px] text-[#71717A]">現況：{preferenceValueLabel("greeting", current.greeting)}</p>
        )}
        <textarea
          id={`${idPrefix}-greeting`}
          rows={4}
          value={value.greeting}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            if (charCount(next) <= GREETING_MAX) setField("greeting", next);
          }}
          placeholder="例如：你好，歡迎查詢，我可以幫你介紹療程同預約時間。"
          className={`mt-3 w-full resize-y rounded-xl border border-[#E4E4E7] bg-white px-3 py-2.5 text-sm leading-relaxed ${highlighted.has("greeting") ? "text-emerald-800" : "text-[#09090B]"} focus:border-[#09090B] focus:outline-none disabled:opacity-60`}
        />
        <div className="mt-2 text-right text-[11px] text-[#71717A]">
          {charCount(value.greeting)} / {GREETING_MAX}
        </div>
      </div>

      {showNotes && onNotesChange && (
        <div className="rounded-2xl border border-[#E4E4E7] bg-white p-4">
          <label htmlFor={`${idPrefix}-notes`} className="block text-xs font-extrabold text-[#09090B]">
            其他調整要求
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-[#71717A]">{NOTES_NOTICE}</p>
          <textarea
            id={`${idPrefix}-notes`}
            rows={4}
            value={notes}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              if (charCount(next) <= NOTES_MAX) onNotesChange(next);
            }}
            placeholder={NOTES_PLACEHOLDER}
            className="mt-3 w-full resize-y rounded-xl border border-[#E4E4E7] bg-white px-3 py-2.5 text-sm leading-relaxed text-[#09090B] focus:border-[#09090B] focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2 text-right text-[11px] text-[#71717A]">
            {charCount(notes)} / {NOTES_MAX}
          </div>
        </div>
      )}
    </div>
  );
}

export function PreferenceReadonly({
  title,
  preferences,
  highlightKeys = [],
}: {
  title: string;
  preferences: Preferences;
  highlightKeys?: (keyof Preferences)[];
}) {
  const highlighted = new Set(highlightKeys);
  return (
    <section className="rounded-2xl border border-[#E4E4E7] bg-white p-4">
      <h3 className="text-sm font-extrabold text-[#09090B]">{title}</h3>
      <dl className="mt-3 space-y-2">
        {visiblePreferenceKeys.map((key) => (
          <div
            key={key}
            className={`flex flex-col gap-0.5 rounded-xl px-3 py-2 text-xs sm:flex-row sm:justify-between ${
              highlighted.has(key) ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-[#FAFAFA]"
            }`}
          >
            <dt className="font-semibold text-[#52525B]">{preferenceLabels[key]}</dt>
            <dd className={`font-bold sm:text-right ${highlighted.has(key) ? "text-emerald-700" : "text-[#09090B]"}`}>{preferenceValueLabel(key, preferences[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
