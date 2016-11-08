import { scores } from "../ratings";

export let label = 'pH';

export let description = `For the Thames to support a variety of wildlife, the
water mustn’t be too acid or alkali. In the past, the pH of the Thames would
have been affected by pollution from industry, killing all wildlife. These
days, we would expect the water to be neutral (neither acid nor alkali) which
is better for wildlife. Volunteers measure the pH of the water to find
this out.`;

export function color(survey) {
  let value = survey.attributes.thames21Ph;
  if (typeof value === 'number') {
    switch (Math.round(value)) {
      case 1:
        return [358, 80, 51];
      case 2:
        return [26, 85, 53];
      case 3:
        return [35, 90, 54];
      case 4:
        return [45, 91, 52];
      case 5:
        return [52, 94, 50];
      case 6:
        return [58, 90, 51];
      case 7:
        return [65, 68, 51];
      case 8:
        return [74, 51, 54];
      case 9:
        return [170, 22, 57];
      case 10:
        return [202, 54, 50];
      case 11:
        return [211, 52, 51];
      case 12:
        return [217, 48, 48];
      case 13:
        return [251, 34, 47];
      case 14:
        return [264, 40, 43];
    }
  }
}

export function score(survey) {
  let value = survey.attributes.thames21Ph;
  if (typeof value === 'number') {
    switch (Math.round(value)) {
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 10:
      case 11:
      case 12:
      case 13:
      case 14:
        return scores['bad'];
      case 6:
      case 9:
        return scores['good'];
      case 7:
      case 8:
        return scores['excellent'];
    }
  }
}