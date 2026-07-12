export type TextMatcher = {
  value: string;
  regex?: boolean;
  flags?: string;
  exact?: boolean;
};

export type LocatorStep =
  | { kind: 'testId' | 'text' | 'label' | 'placeholder' | 'altText' | 'title'; matcher: TextMatcher }
  | { kind: 'role'; role: string; name?: TextMatcher }
  | { kind: 'css' | 'xpath'; value: string }
  | { kind: 'filter'; hasText?: TextMatcher; hasNotText?: TextMatcher }
  | { kind: 'nth'; index: number }
  | { kind: 'first' | 'last' }
  | { kind: 'frame'; value: string };

export interface LocatorExpression {
  source: string;
  steps: LocatorStep[];
  unsupported?: string[];
}
