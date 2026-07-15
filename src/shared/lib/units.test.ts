import { convert, convertValue, displayUnit } from './units';

describe('convert (metric = identity)', () => {
  it('passes every value+unit through unchanged in metric', () => {
    expect(convert(100, 'km/h', 'metric')).toEqual({ value: 100, unit: 'km/h' });
    expect(convert(90, '°C', 'metric')).toEqual({ value: 90, unit: '°C' });
    expect(convert(null, 'km', 'metric')).toEqual({ value: null, unit: 'km' });
  });
});

describe('convert (imperial)', () => {
  it('converts speed km/h → mph', () => {
    const m = convert(100, 'km/h', 'imperial');
    expect(m.unit).toBe('mph');
    expect(m.value).toBeCloseTo(62.137, 2);
  });

  it('converts temperature °C → °F (including below zero)', () => {
    expect(convert(100, '°C', 'imperial')).toEqual({ value: 212, unit: '°F' });
    expect(convert(0, '°C', 'imperial')).toEqual({ value: 32, unit: '°F' });
    expect(convert(-40, '°C', 'imperial')).toEqual({ value: -40, unit: '°F' });
  });

  it('converts distance km → mi', () => {
    const m = convert(160.9344, 'km', 'imperial');
    expect(m.unit).toBe('mi');
    expect(m.value).toBeCloseTo(100, 5);
  });

  it('converts pressure kPa → psi and bar → psi', () => {
    expect(convert(100, 'kPa', 'imperial').unit).toBe('psi');
    expect(convert(100, 'kPa', 'imperial').value).toBeCloseTo(14.5038, 3);
    expect(convert(1, 'bar', 'imperial').value).toBeCloseTo(14.5038, 3);
  });

  it('converts fuel economy L/100km → US MPG (reciprocal)', () => {
    const m = convert(9.4, 'L/100km', 'imperial');
    expect(m.unit).toBe('mpg');
    expect(m.value).toBeCloseTo(25.02, 1);
  });

  it('maps zero/negative L/100km to a null MPG (no divide-by-zero)', () => {
    expect(convert(0, 'L/100km', 'imperial')).toEqual({ value: null, unit: 'mpg' });
    expect(convert(-1, 'L/100km', 'imperial')).toEqual({ value: null, unit: 'mpg' });
  });

  it('relabels the unit even when the value is null', () => {
    expect(convert(null, 'km/h', 'imperial')).toEqual({ value: null, unit: 'mph' });
  });

  it('passes unknown units through untouched', () => {
    expect(convert(820, 'rpm', 'imperial')).toEqual({ value: 820, unit: 'rpm' });
    expect(convert(45, '%', 'imperial')).toEqual({ value: 45, unit: '%' });
    expect(convert(13.9, 'V', 'imperial')).toEqual({ value: 13.9, unit: 'V' });
    expect(convert(3.2, 'g/s', 'imperial')).toEqual({ value: 3.2, unit: 'g/s' });
  });
});

describe('convertValue / displayUnit', () => {
  it('convertValue returns just the number', () => {
    expect(convertValue(100, 'km/h', 'metric')).toBe(100);
    expect(convertValue(100, 'km/h', 'imperial')).toBeCloseTo(62.137, 2);
    expect(convertValue(null, 'km/h', 'imperial')).toBeNull();
  });

  it('displayUnit returns the imperial label without a value', () => {
    expect(displayUnit('km/h', 'metric')).toBe('km/h');
    expect(displayUnit('km/h', 'imperial')).toBe('mph');
    expect(displayUnit('rpm', 'imperial')).toBe('rpm');
  });
});
