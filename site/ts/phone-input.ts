import type { Iti } from 'intl-tel-input';
import intlTelInput from 'intl-tel-input/intlTelInputWithUtils';

/**
 * Initialise intl-tel-input on a <input type="tel"> element.
 * Returns the Iti instance so callers can read/validate the number.
 */
export function initPhoneInput(input: HTMLInputElement, initialValue?: string): Iti {
    const iti = intlTelInput(input, {
        initialCountry: 'us',
        nationalMode: true,
        formatAsYouType: true,
        countrySearch: true,
        showFlags: true,
    });
    if (initialValue) {
        iti.setNumber(initialValue);
    }
    return iti;
}
