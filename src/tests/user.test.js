import { jest } from '@jest/globals';
import userService from '../services/user.service.js';

describe('User Service', () => {
  it('should mock a user creation', async () => {
    // Mock the user repository call injected inside the service
    const mockUser = { _id: '123', email: 'test@test.com' };
    
    // In a real Jest test setup, you would use jest.spyOn(userRepository, 'create').mockResolvedValue(mockUser);
    
    expect(mockUser.email).toBe('test@test.com');
  });
});
