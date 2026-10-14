<?php

namespace Drupal\parenting_schedule\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class ScheduleController extends ControllerBase {

  const CSRF_ID = 'parenting_schedule';

  public function frontend() {
    return [
      '#theme' => 'parenting_schedule_frontend',
      '#attached' => [
        'library' => ['parenting_schedule/schedule_ui'],
        'drupalSettings' => [
          'parentingSchedule' => [
            'editable' => FALSE,
            'csrfToken' => \Drupal::csrfToken()->get(self::CSRF_ID),
          ],
        ],
      ],
    ];
  }

  public function admin() {
    return [
      '#theme' => 'parenting_schedule_admin',
      '#attached' => [
        'library' => ['parenting_schedule/schedule_ui'],
        'drupalSettings' => [
          'parentingSchedule' => [
            'editable' => TRUE,
            'csrfToken' => \Drupal::csrfToken()->get(self::CSRF_ID),
          ],
        ],
      ],
    ];
  }

  public function apiEndpoint() {
    $database = \Drupal::database();

    $months = $database->select('parenting_schedule_months', 'm')
      ->fields('m', ['year', 'month'])
      ->orderBy('year')
      ->orderBy('month')
      ->execute()
      ->fetchAll();

    $days = $database->select('parenting_schedule_days', 'd')
      ->fields('d', ['day_date', 'day_type', 'exchange_time', 'exchange_type', 'parent', 'label', 'occasion'])
      ->execute()
      ->fetchAll();

    return new JsonResponse(['months' => $months, 'days' => $days]);
  }

  public function saveDay(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];

    $date = $data['date'] ?? '';
    $dayType = $data['day_type'] ?? '';

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Invalid date.'], 400);
    }

    $fields = [
      'day_type' => $dayType,
      'exchange_time' => NULL,
      'exchange_type' => NULL,
      'parent' => NULL,
      'label' => ('' !== trim((string) ($data['label'] ?? ''))) ? trim($data['label']) : NULL,
      'occasion' => ('' !== trim((string) ($data['occasion'] ?? ''))) ? trim($data['occasion']) : NULL,
    ];

    if ($dayType === 'exchange') {
      $time = $data['exchange_time'] ?? '';
      $type = $data['exchange_type'] ?? '';
      if (!preg_match('/^\d{2}:\d{2}$/', $time) || !in_array($type, ['eric_to_sarah', 'sarah_to_eric'], TRUE)) {
        return new JsonResponse(['success' => FALSE, 'message' => 'Exchange time and exchange direction are required.'], 400);
      }
      $fields['exchange_time'] = $time;
      $fields['exchange_type'] = $type;
    }
    elseif ($dayType === 'parenting') {
      $parent = $data['parent'] ?? '';
      if (!in_array($parent, ['eric', 'sarah'], TRUE)) {
        return new JsonResponse(['success' => FALSE, 'message' => 'Parent is required for a parenting day.'], 400);
      }
      $fields['parent'] = $parent;
    }
    else {
      return new JsonResponse(['success' => FALSE, 'message' => 'Day type must be either Exchange Day or Parenting Day.'], 400);
    }

    \Drupal::database()->merge('parenting_schedule_days')
      ->key('day_date', $date)
      ->fields($fields)
      ->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  public function deleteDay(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $date = $data['date'] ?? '';

    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
      \Drupal::database()->delete('parenting_schedule_days')
        ->condition('day_date', $date)
        ->execute();
    }

    return new JsonResponse(['success' => TRUE]);
  }

  public function addMonth(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $year = (int) ($data['year'] ?? 0);
    $month = (int) ($data['month'] ?? 0);

    if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) {
      return new JsonResponse(['success' => FALSE, 'message' => 'Please provide a valid year and month.'], 400);
    }

    $database = \Drupal::database();
    $exists = $database->select('parenting_schedule_months', 'm')
      ->condition('year', $year)
      ->condition('month', $month)
      ->countQuery()
      ->execute()
      ->fetchField();

    if ($exists) {
      return new JsonResponse(['success' => FALSE, 'message' => 'That month has already been added.'], 400);
    }

    $database->insert('parenting_schedule_months')
      ->fields(['year' => $year, 'month' => $month])
      ->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  public function deleteMonth(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $year = (int) ($data['year'] ?? 0);
    $month = (int) ($data['month'] ?? 0);

    $database = \Drupal::database();
    $database->delete('parenting_schedule_months')
      ->condition('year', $year)
      ->condition('month', $month)
      ->execute();

    $prefix = sprintf('%04d-%02d-', $year, $month);
    $database->delete('parenting_schedule_days')
      ->condition('day_date', $database->escapeLike($prefix) . '%', 'LIKE')
      ->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  public function importData(Request $request) {
    $this->checkCsrf($request);
    $data = json_decode($request->getContent(), TRUE) ?: [];
    $months = $data['months'] ?? [];
    $days = $data['days'] ?? [];

    $database = \Drupal::database();
    $database->truncate('parenting_schedule_months')->execute();
    $database->truncate('parenting_schedule_days')->execute();

    foreach ($months as $m) {
      if (empty($m['year']) || empty($m['month'])) {
        continue;
      }
      $database->merge('parenting_schedule_months')
        ->keys(['year' => (int) $m['year'], 'month' => (int) $m['month']])
        ->execute();
    }

    foreach ($days as $d) {
      if (empty($d['day_date']) || empty($d['day_type'])) {
        continue;
      }
      $database->merge('parenting_schedule_days')
        ->key('day_date', $d['day_date'])
        ->fields([
          'day_type' => $d['day_type'],
          'exchange_time' => $d['exchange_time'] ?? NULL,
          'exchange_type' => $d['exchange_type'] ?? NULL,
          'parent' => $d['parent'] ?? NULL,
          'label' => $d['label'] ?? NULL,
          'occasion' => $d['occasion'] ?? NULL,
        ])
        ->execute();
    }

    return new JsonResponse(['success' => TRUE]);
  }

  public function clearAll(Request $request) {
    $this->checkCsrf($request);
    $database = \Drupal::database();
    $database->truncate('parenting_schedule_months')->execute();
    $database->truncate('parenting_schedule_days')->execute();

    return new JsonResponse(['success' => TRUE]);
  }

  protected function checkCsrf(Request $request) {
    $token = $request->headers->get('X-CSRF-Token', '');
    if (!\Drupal::csrfToken()->validate($token, self::CSRF_ID)) {
      throw new AccessDeniedHttpException('Invalid or missing CSRF token.');
    }
  }

}
