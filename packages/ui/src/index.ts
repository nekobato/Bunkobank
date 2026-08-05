/** Shared Shelfmark theme primitives for the Bunkobank Vue applications. */

import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

/** Semantic status tones shared by Desktop Manager and Web Library. */
export type ShelfmarkTone =
  "neutral" | "info" | "success" | "warning" | "danger";

/** PrimeVue-compatible metadata for a Shelfmark status tone. */
export interface ShelfmarkToneMeta {
  severity: "secondary" | "info" | "success" | "warn" | "danger";
  className: `tone-${ShelfmarkTone}`;
}

/** Approved signature colors for the Shelfmark visual system. */
export const shelfmarkPalette = {
  deepShelf: "#17353C",
  fog: "#EEF2F2",
  paper: "#F7F9F8",
  inkBlue: "#3159A8",
  spineCoral: "#F26F4F",
  patina: "#75A59B"
} as const;

/** Complete Japanese locale values required by PrimeVue configuration. */
export const shelfmarkJapaneseLocale = {
  accept: "適用",
  reject: "キャンセル",
  choose: "選択",
  upload: "アップロード",
  cancel: "キャンセル",
  clear: "クリア",
  apply: "適用",
  completed: "完了",
  pending: "待機中",
  fileSizeTypes: ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
  dayNames: [
    "日曜日",
    "月曜日",
    "火曜日",
    "水曜日",
    "木曜日",
    "金曜日",
    "土曜日"
  ],
  dayNamesShort: ["日", "月", "火", "水", "木", "金", "土"],
  dayNamesMin: ["日", "月", "火", "水", "木", "金", "土"],
  monthNames: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月"
  ],
  monthNamesShort: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月"
  ],
  firstDayOfWeek: 0,
  showMonthAfterYear: true,
  dateFormat: "yy/mm/dd",
  today: "今日",
  weekHeader: "週",
  weak: "弱い",
  medium: "標準",
  strong: "強い",
  passwordPrompt: "パスワードを入力してください",
  emptyMessage: "項目がありません",
  emptySearchMessage: "該当する項目がありません",
  emptyFilterMessage: "該当する項目がありません",
  aria: {
    trueLabel: "はい",
    falseLabel: "いいえ",
    close: "閉じる",
    previous: "前へ",
    next: "次へ",
    navigation: "ナビゲーション",
    scrollTop: "先頭へ移動",
    selectAll: "すべて選択",
    unselectAll: "すべて解除",
    pageLabel: "ページ {page}",
    firstPageLabel: "最初のページ",
    lastPageLabel: "最後のページ",
    nextPageLabel: "次のページ",
    prevPageLabel: "前のページ",
    jumpToPageInputLabel: "ページを指定",
    expandRow: "行を展開",
    collapseRow: "行を折りたたむ",
    listView: "リスト表示",
    gridView: "グリッド表示",
    zoomIn: "拡大",
    zoomOut: "縮小"
  }
};

const shelfmarkToneMetadata: Record<ShelfmarkTone, ShelfmarkToneMeta> = {
  neutral: { severity: "secondary", className: "tone-neutral" },
  info: { severity: "info", className: "tone-info" },
  success: { severity: "success", className: "tone-success" },
  warning: { severity: "warn", className: "tone-warning" },
  danger: { severity: "danger", className: "tone-danger" }
};

/** Returns PrimeVue severity and CSS class metadata for a semantic tone. */
export const getShelfmarkToneMeta = (tone: ShelfmarkTone): ShelfmarkToneMeta =>
  shelfmarkToneMetadata[tone];

/** PrimeVue preset implementing the shared Shelfmark color and shape system. */
export const shelfmarkPreset = definePreset(Aura, {
  primitive: {
    shelf: {
      50: "#F2F7F6",
      100: "#E3ECEA",
      200: "#C8DAD7",
      300: "#A5C1BD",
      400: "#75A59B",
      500: "#4E887F",
      600: "#376D67",
      700: "#2B5754",
      800: "#214543",
      900: "#17353C",
      950: "#0B2025"
    },
    inkblue: {
      50: "#F1F4FC",
      100: "#E2E8F8",
      200: "#C8D3F0",
      300: "#A2B3E4",
      400: "#748BD4",
      500: "#536BC0",
      600: "#3E55AD",
      700: "#3159A8",
      800: "#2A4382",
      900: "#263967",
      950: "#182240"
    },
    coral: {
      50: "#FFF4F0",
      100: "#FFE6DE",
      200: "#FFCDC0",
      300: "#FBAA96",
      400: "#F68368",
      500: "#F26F4F",
      600: "#DB4B2C",
      700: "#B83A22",
      800: "#96321F",
      900: "#7B2F22",
      950: "#43150D"
    }
  },
  semantic: {
    disabledOpacity: "1",
    primary: {
      50: "{inkblue.50}",
      100: "{inkblue.100}",
      200: "{inkblue.200}",
      300: "{inkblue.300}",
      400: "{inkblue.400}",
      500: "{inkblue.500}",
      600: "{inkblue.600}",
      700: "{inkblue.700}",
      800: "{inkblue.800}",
      900: "{inkblue.900}",
      950: "{inkblue.950}"
    },
    borderRadius: {
      none: "0",
      xs: "0.25rem",
      sm: "0.375rem",
      md: "0.625rem",
      lg: "0.875rem",
      xl: "1.125rem"
    },
    focusRing: {
      width: "0.1875rem",
      style: "solid",
      color: "{primary.500}",
      offset: "0.1875rem"
    },
    colorScheme: {
      light: {
        surface: {
          0: "#FFFFFF",
          50: "#F7F9F8",
          100: "#EEF2F2",
          200: "#DCE5E4",
          300: "#C7D4D3",
          400: "#98ADAA",
          500: "#718784",
          600: "#526A68",
          700: "#3D5352",
          800: "#293D3F",
          900: "#17353C",
          950: "#0B2025"
        },
        primary: {
          color: "{inkblue.700}",
          inverseColor: "#FFFFFF",
          hoverColor: "{inkblue.800}",
          activeColor: "{inkblue.900}"
        },
        formField: {
          background: "{surface.0}",
          disabledBackground: "{surface.100}",
          filledBackground: "{surface.50}",
          filledHoverBackground: "{surface.100}",
          filledFocusBackground: "{surface.0}",
          borderColor: "{surface.300}",
          hoverBorderColor: "{primary.color}",
          focusBorderColor: "{primary.color}",
          invalidBorderColor: "{red.500}",
          color: "{surface.900}",
          disabledColor: "{surface.500}",
          placeholderColor: "{surface.500}",
          invalidPlaceholderColor: "{red.600}",
          floatLabelColor: "{surface.500}",
          floatLabelFocusColor: "{primary.700}",
          floatLabelActiveColor: "{surface.500}",
          floatLabelInvalidColor: "{form.field.invalid.placeholder.color}",
          iconColor: "{surface.500}",
          shadow: "0 0 0 0 transparent"
        }
      },
      dark: {
        surface: {
          0: "#FFFFFF",
          50: "#EAF1EF",
          100: "#CBD9D6",
          200: "#A8BCB8",
          300: "#7F9A96",
          400: "#607A77",
          500: "#455F5E",
          600: "#324B4D",
          700: "#243A3E",
          800: "#182C31",
          900: "#102126",
          950: "#09161A"
        },
        primary: {
          color: "{inkblue.300}",
          inverseColor: "{surface.950}",
          hoverColor: "{inkblue.200}",
          activeColor: "{inkblue.100}"
        },
        formField: {
          background: "{surface.800}",
          disabledBackground: "{surface.900}",
          filledBackground: "{surface.800}",
          filledHoverBackground: "{surface.700}",
          filledFocusBackground: "{surface.800}",
          borderColor: "{surface.600}",
          hoverBorderColor: "{primary.color}",
          focusBorderColor: "{primary.color}",
          invalidBorderColor: "{red.400}",
          color: "{surface.50}",
          disabledColor: "{surface.400}",
          placeholderColor: "{surface.400}",
          invalidPlaceholderColor: "{red.400}",
          floatLabelColor: "{surface.400}",
          floatLabelFocusColor: "{primary.color}",
          floatLabelActiveColor: "{surface.400}",
          floatLabelInvalidColor: "{form.field.invalid.placeholder.color}",
          iconColor: "{surface.400}",
          shadow: "0 0 0 0 transparent"
        }
      }
    }
  }
});

/** PrimeVue theme configuration for the system-dark Desktop Manager. */
export const desktopShelfmarkTheme = {
  preset: shelfmarkPreset,
  options: {
    prefix: "p",
    darkModeSelector: "system",
    cssLayer: { name: "primevue", order: "primevue, bunkobank" }
  }
} as const;

/** PrimeVue theme configuration for the light Web Library shell. */
export const webShelfmarkTheme = {
  preset: shelfmarkPreset,
  options: {
    prefix: "p",
    darkModeSelector: false,
    cssLayer: { name: "primevue", order: "primevue, bunkobank" }
  }
} as const;
