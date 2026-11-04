"""Fictional card details for the simulator; never connected to payment rails."""
import secrets


def card_details(network):
    prefix = {'visa': '4', 'rupay': '60', 'mastercard': str(51 + secrets.randbelow(5))}[network]
    stem = prefix + ''.join(str(secrets.randbelow(10)) for _ in range(15 - len(prefix)))
    total = sum((n * 2 - 9 if n * 2 > 9 else n * 2) if i % 2 == 0 else n
                for i, n in enumerate(map(int, stem)))
    return stem + str(-total % 10), f'{secrets.randbelow(1000):03d}'
