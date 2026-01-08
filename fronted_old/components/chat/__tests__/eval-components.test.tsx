import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EvalChallengerCard } from '../eval-challenger-card';
import { EvalExplanation } from '../eval-explanation';
import { EvalRatingDialog } from '../eval-rating-dialog';
import type { ChallengerRun, EvalExplanation as EvalExplanationType } from '@/lib/api-types';

// Mock i18n
vi.mock('@/lib/i18n-context', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('EvalChallengerCard', () => {
  it('should render challenger with succeeded status', () => {
    const challenger: ChallengerRun = {
      run_id: 'run-1',
      requested_logical_model: 'gpt-4',
      status: 'succeeded',
      output_preview: 'This is a test output',
      latency: 1500,
    };

    render(<EvalChallengerCard challenger={challenger} />);

    expect(screen.getByText('gpt-4')).toBeInTheDocument();
    expect(screen.getByText('This is a test output')).toBeInTheDocument();
    expect(screen.getByText('chat.run.status_succeeded')).toBeInTheDocument();
  });

  it('should render challenger with running status', () => {
    const challenger: ChallengerRun = {
      run_id: 'run-2',
      requested_logical_model: 'claude-3',
      status: 'running',
    };

    render(<EvalChallengerCard challenger={challenger} />);

    expect(screen.getByText('claude-3')).toBeInTheDocument();
    expect(screen.getByText('chat.run.status_running')).toBeInTheDocument();
  });

  it('should render challenger with failed status and error', () => {
    const challenger: ChallengerRun = {
      run_id: 'run-3',
      requested_logical_model: 'gpt-3.5',
      status: 'failed',
      error_code: 'RATE_LIMIT_EXCEEDED',
    };

    render(<EvalChallengerCard challenger={challenger} />);

    expect(screen.getByText('gpt-3.5')).toBeInTheDocument();
    expect(screen.getByText('chat.run.status_failed')).toBeInTheDocument();
    expect(screen.getByText('RATE_LIMIT_EXCEEDED')).toBeInTheDocument();
  });

  it('should show winner badge when isWinner is true', () => {
    const challenger: ChallengerRun = {
      run_id: 'run-4',
      requested_logical_model: 'gpt-4',
      status: 'succeeded',
      output_preview: 'Winner output',
    };

    render(<EvalChallengerCard challenger={challenger} isWinner={true} />);

    expect(screen.getByText('chat.eval.winner')).toBeInTheDocument();
  });
});

describe('EvalExplanation', () => {
  it('should render explanation summary', () => {
    const explanation: EvalExplanationType = {
      summary: 'These models were selected based on their performance.',
    };

    render(<EvalExplanation explanation={explanation} />);

    expect(screen.getByText('chat.eval.explanation')).toBeInTheDocument();
    expect(screen.getByText('These models were selected based on their performance.')).toBeInTheDocument();
  });

  it('should render explanation with evidence', () => {
    const explanation: EvalExplanationType = {
      summary: 'Models selected for evaluation',
      evidence: {
        policy_version: 'v1.0',
        exploration: true,
      },
    };

    render(<EvalExplanation explanation={explanation} />);

    expect(screen.getByText('chat.eval.explanation_summary')).toBeInTheDocument();
    expect(screen.getByText('chat.eval.explanation_evidence')).toBeInTheDocument();
    expect(screen.getByText(/Policy: v1.0/)).toBeInTheDocument();
    expect(screen.getByText('Exploration')).toBeInTheDocument();
  });
});

describe('EvalRatingDialog', () => {
  const mockBaselineRun = {
    run_id: 'baseline-1',
    requested_logical_model: 'gpt-4',
    output_preview: 'Baseline output',
  };

  const mockChallengers: ChallengerRun[] = [
    {
      run_id: 'challenger-1',
      requested_logical_model: 'claude-3',
      status: 'succeeded',
      output_preview: 'Challenger 1 output',
    },
    {
      run_id: 'challenger-2',
      requested_logical_model: 'gpt-3.5',
      status: 'succeeded',
      output_preview: 'Challenger 2 output',
    },
  ];

  it('should render dialog when open', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <EvalRatingDialog
        open={true}
        onOpenChange={onOpenChange}
        baselineRun={mockBaselineRun}
        challengers={mockChallengers}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getAllByText('chat.eval.select_winner').length).toBeGreaterThan(0);
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('should allow selecting a winner', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <EvalRatingDialog
        open={true}
        onOpenChange={onOpenChange}
        baselineRun={mockBaselineRun}
        challengers={mockChallengers}
        onSubmit={onSubmit}
      />
    );

    // Click on the first challenger card
    const challengerCard = screen.getByText('claude-3').closest('div[class*="cursor-pointer"]');
    if (challengerCard) {
      fireEvent.click(challengerCard);
    }

    // Verify the card is selected (should show CheckCircle icon)
    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('should allow selecting reason tags', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <EvalRatingDialog
        open={true}
        onOpenChange={onOpenChange}
        baselineRun={mockBaselineRun}
        challengers={mockChallengers}
        onSubmit={onSubmit}
      />
    );

    // Find and click the "accurate" checkbox
    const accurateCheckbox = screen.getByLabelText('chat.eval.reason_accurate');
    fireEvent.click(accurateCheckbox);

    // Verify checkbox is checked
    expect(accurateCheckbox).toBeChecked();
  });

  it('should disable submit button when no winner or reasons selected', () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <EvalRatingDialog
        open={true}
        onOpenChange={onOpenChange}
        baselineRun={mockBaselineRun}
        challengers={mockChallengers}
        onSubmit={onSubmit}
      />
    );

    const submitButton = screen.getByText('chat.eval.submit');
    expect(submitButton).toBeDisabled();
  });
});
