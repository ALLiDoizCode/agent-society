/**
 * Manual Jest mock for @toon-protocol/memvid-node
 *
 * The native napi-rs addon is not available in CI or test environments.
 * This mock provides the same shape expected by createPetDvmHandler tests.
 */

const mockBrainInstance = {
  putBytes: jest.fn().mockReturnValue(1),
  commit: jest.fn(),
  hash: jest.fn().mockReturnValue('a'.repeat(64)),
  close: jest.fn(),
};

export const PetBrain = {
  open: jest.fn().mockImplementation(() => mockBrainInstance),
  create: jest.fn().mockImplementation(() => mockBrainInstance),
};
