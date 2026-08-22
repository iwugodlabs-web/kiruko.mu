/**
 * AdsConsentModal tests (M12 / Phase 2).
 *
 * Verifies:
 *   - First render with no prior answer → modal visible
 *   - Render with a matching stored answer → modal hidden
 *   - Render with an older policy_version on disk → modal visible (re-consent loop)
 *   - Accept → posts {accepted: true}, persists answer, hides modal
 *   - Decline → posts {accepted: false}, persists answer, hides modal
 *   - postAdsConsent throw → modal hides but answer NOT persisted (so a retry
 *     is presented next launch, instead of silently flipping the wrong way)
 *
 * Uses react-test-renderer + tiny harness component (no @testing-library/
 * react-native dependency, same pattern as useSponsoredSlot.test.ts).
 */

jest.mock('@react-native-async-storage/async-storage', () => {
    let store: Record<string, string> = {};
    const mock = {
        getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
        setItem: jest.fn(async (k: string, v: string) => {
            store[k] = v;
        }),
        removeItem: jest.fn(async (k: string) => {
            delete store[k];
        }),
        __reset: () => {
            store = {};
            mock.getItem.mockClear();
            mock.setItem.mockClear();
            mock.removeItem.mockClear();
        },
    };
    return { __esModule: true, default: mock };
});

jest.mock('../../api/sponsored', () => ({
    postAdsConsent: jest.fn(),
    withdrawAdsConsent: jest.fn(),
    getAdsConsent: jest.fn(),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import AdsConsentModal, {
    ADS_CONSENT_STORAGE_KEY,
    ADS_CONSENT_POLICY_VERSION,
    hasAnsweredAdsConsent,
} from '../../components/AdsConsentModal';
import * as sponsoredApi from '../../api/sponsored';

// AsyncStorage mock with reset helper
type ResettableStorage = typeof AsyncStorage & { __reset: () => void };
const storage = AsyncStorage as ResettableStorage;

beforeEach(() => {
    storage.__reset();
    (sponsoredApi.postAdsConsent as jest.Mock).mockReset();
    // Default: company has ads enabled — the modal should prompt. Tests
    // that need the negative case (company ads off) override this per-case.
    (sponsoredApi.getAdsConsent as jest.Mock).mockReset();
    (sponsoredApi.getAdsConsent as jest.Mock).mockResolvedValue({
        ok: true,
        ads_consent_at: null,
        is_ad_free: false,
        company_ads_enabled: true,
    });
});

async function flush(renderer: TestRenderer.ReactTestRenderer) {
    // Drain microtasks until the modal's effect resolves. The first-launch
    // path now does TWO async hops (hasAnswered → getAdsConsent → setState),
    // so we drain a few extra times to make sure everything settles before
    // assertions read the rendered tree.
    await act(async () => {
        for (let i = 0; i < 6; i += 1) {
            await Promise.resolve();
        }
    });
    return renderer;
}

function findModal(renderer: TestRenderer.ReactTestRenderer) {
    return renderer.root.findAllByType(Modal)[0];
}

describe('AdsConsentModal', () => {
    it('renders visible on first launch when no prior answer is stored', async () => {
        (sponsoredApi.postAdsConsent as jest.Mock).mockResolvedValue({
            ok: true,
            ads_consent_at: null,
            is_ad_free: true,
        });
        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);
        const modal = findModal(renderer);
        expect(modal.props.visible).toBe(true);
    });

    it('stays hidden when a matching policy_version is already on disk', async () => {
        await storage.setItem(
            ADS_CONSENT_STORAGE_KEY,
            JSON.stringify({
                answered: true,
                accepted: true,
                policy_version: ADS_CONSENT_POLICY_VERSION,
                at: new Date().toISOString(),
            }),
        );
        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);
        const modal = findModal(renderer);
        expect(modal.props.visible).toBe(false);
    });

    it('re-prompts when the stored policy_version differs from current', async () => {
        // Stale stored answer (older policy revision).
        await storage.setItem(
            ADS_CONSENT_STORAGE_KEY,
            JSON.stringify({
                answered: true,
                accepted: true,
                policy_version: '2025-01-01',
                at: '2025-01-01T00:00:00Z',
            }),
        );
        // Sanity-check the helper directly.
        const answered = await hasAnsweredAdsConsent();
        expect(answered).toBe(false);

        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);
        const modal = findModal(renderer);
        expect(modal.props.visible).toBe(true);
    });

    it('accepting posts {accepted: true} and persists the answer', async () => {
        (sponsoredApi.postAdsConsent as jest.Mock).mockResolvedValue({
            ok: true,
            ads_consent_at: new Date().toISOString(),
            is_ad_free: false,
        });
        const onResolved = jest.fn();
        const renderer = TestRenderer.create(<AdsConsentModal onResolved={onResolved} />);
        await flush(renderer);

        // Click the accept button (testID added in component).
        const acceptButton = renderer.root.findAll(
            (n) => n.props && n.props.testID === 'ads-consent-accept' && typeof n.props.onPress === 'function',
        )[0];
        expect(acceptButton).toBeDefined();
        await act(async () => {
            acceptButton.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(sponsoredApi.postAdsConsent).toHaveBeenCalledWith(
            true,
            ADS_CONSENT_POLICY_VERSION,
        );
        const stored = JSON.parse((await storage.getItem(ADS_CONSENT_STORAGE_KEY))!);
        expect(stored.accepted).toBe(true);
        expect(stored.policy_version).toBe(ADS_CONSENT_POLICY_VERSION);
        expect(onResolved).toHaveBeenCalledWith(true);
        // Modal hidden after answer.
        expect(findModal(renderer).props.visible).toBe(false);
    });

    it('declining posts {accepted: false} and persists', async () => {
        (sponsoredApi.postAdsConsent as jest.Mock).mockResolvedValue({
            ok: true,
            ads_consent_at: null,
            is_ad_free: true,
        });
        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);

        const declineButton = renderer.root.findAll(
            (n) => n.props && n.props.testID === 'ads-consent-decline' && typeof n.props.onPress === 'function',
        )[0];
        expect(declineButton).toBeDefined();
        await act(async () => {
            declineButton.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(sponsoredApi.postAdsConsent).toHaveBeenCalledWith(
            false,
            ADS_CONSENT_POLICY_VERSION,
        );
        const stored = JSON.parse((await storage.getItem(ADS_CONSENT_STORAGE_KEY))!);
        expect(stored.accepted).toBe(false);
    });

    it('does NOT persist when the server call throws — re-prompts next launch', async () => {
        (sponsoredApi.postAdsConsent as jest.Mock).mockRejectedValue(
            new Error('network down'),
        );
        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);

        const acceptButton = renderer.root.findAll(
            (n) => n.props && n.props.testID === 'ads-consent-accept' && typeof n.props.onPress === 'function',
        )[0];
        await act(async () => {
            acceptButton.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        // Server failed → modal closes (so the user isn't stuck) but the
        // answer is NOT saved on disk, which means the next mount will
        // re-prompt instead of silently flipping the wrong way.
        const stored = await storage.getItem(ADS_CONSENT_STORAGE_KEY);
        expect(stored).toBeNull();
    });

    it('stays hidden when the user\'s company has ads_enabled=false', async () => {
        // No prior answer on disk; would normally prompt. But server says
        // the company has ads disabled — modal must NOT show, and we must
        // NOT persist a default answer (so the prompt fires next time
        // if/when ads_enabled flips to true).
        (sponsoredApi.getAdsConsent as jest.Mock).mockResolvedValue({
            ok: true,
            ads_consent_at: null,
            is_ad_free: false,
            company_ads_enabled: false,
        });
        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);
        expect(findModal(renderer).props.visible).toBe(false);
        // Critically: nothing persisted, so we re-check next launch.
        const stored = await storage.getItem(ADS_CONSENT_STORAGE_KEY);
        expect(stored).toBeNull();
    });

    it('shows when the server probe fails (conservative default: ask)', async () => {
        // Server unreachable → don't silently hide. Better to ask once
        // and let the user decline than to ship a stuck "no" state.
        (sponsoredApi.getAdsConsent as jest.Mock).mockResolvedValue(null);
        const renderer = TestRenderer.create(<AdsConsentModal />);
        await flush(renderer);
        expect(findModal(renderer).props.visible).toBe(true);
    });

    it('forceShow=true bypasses the stored-answer check', async () => {
        await storage.setItem(
            ADS_CONSENT_STORAGE_KEY,
            JSON.stringify({
                answered: true,
                accepted: true,
                policy_version: ADS_CONSENT_POLICY_VERSION,
                at: new Date().toISOString(),
            }),
        );
        const renderer = TestRenderer.create(<AdsConsentModal forceShow />);
        await flush(renderer);
        expect(findModal(renderer).props.visible).toBe(true);
    });
});
